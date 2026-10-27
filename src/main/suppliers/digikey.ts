// DigiKey Product Information API v4. One part number per request.
// OAuth 2.0 client credentials; the account number header selects the
// account's own prices (MyPricing).
// https://developer.digikey.com/products/product-information-v4

import { z } from "zod";
import { digikeyLifecycle } from "../../shared/lifecycle";
import { otherPackagingNote } from "../../shared/line-text";
import type { LookupOutcome, SupplierOffer } from "../../shared/model";
import { partNumberKey } from "../../shared/model";
import { retryAfterMs } from "../collection/http";
import { matchOutcome, normalizeCurrency, sortBreaks } from "./matching";
import {
    AuthError,
    QuotaExceededError,
    SupplierError,
    ThrottledError,
    type SupplierContext,
    type SupplierPlugin
} from "./types";

const PRODUCTION_URL = "https://api.digikey.com";
const SANDBOX_URL = "https://sandbox-api.digikey.com";

const tokenSchema = z.looseObject({
    access_token: z.string(),
    expires_in: z.number().optional()
});

const priceBreakSchema = z.looseObject({
    BreakQuantity: z.number(),
    UnitPrice: z.number()
});

const variationSchema = z.looseObject({
    DigiKeyProductNumber: z.string(),
    PackageType: z.looseObject({ Name: z.string().nullish() }).nullish(),
    StandardPricing: z.array(priceBreakSchema).nullish(),
    MyPricing: z.array(priceBreakSchema).nullish(),
    MinimumOrderQuantity: z.number().nullish(),
    QuantityAvailableforPackageType: z.number().nullish(),
    DigiReelFee: z.number().nullish()
});

const productDetailsSchema = z.looseObject({
    Product: z.looseObject({
        Manufacturer: z.looseObject({ Name: z.string().nullish() }).nullish(),
        ManufacturerProductNumber: z.string().nullish(),
        Description: z
            .looseObject({ ProductDescription: z.string().nullish() })
            .nullish(),
        QuantityAvailable: z.number().nullish(),
        ProductStatus: z
            .looseObject({ Status: z.string().nullish() })
            .nullish(),
        Classifications: z
            .looseObject({ RohsStatus: z.string().nullish() })
            .nullish(),
        ProductUrl: z.string().nullish(),
        DatasheetUrl: z.string().nullish(),
        ProductVariations: z.array(variationSchema).nullish()
    }),
    SearchLocaleUsed: z
        .looseObject({ Currency: z.string().nullish() })
        .nullish()
});

type ProductDetails = z.infer<typeof productDetailsSchema>;

const tokens = new Map<string, { token: string; expiresAt: number }>();

export const digikey: SupplierPlugin = {
    id: "digikey",
    batchSize: 1,
    requestsPerBatch: 1,
    requiredSecrets: ["clientId", "clientSecret"],
    testPartNumber: "RMCF0805FT100KCT-ND",

    async lookup(partNumbers, context) {
        const outcomes = new Map<string, LookupOutcome>();
        for (const partNumber of partNumbers) {
            outcomes.set(
                partNumberKey(partNumber),
                await lookupOne(partNumber, context)
            );
        }
        return outcomes;
    }
};

function baseUrl(context: SupplierContext): string {
    return context.baseUrl(
        context.config.environment === "sandbox" ? SANDBOX_URL : PRODUCTION_URL
    );
}

async function lookupOne(
    partNumber: string,
    context: SupplierContext
): Promise<LookupOutcome> {
    const { config, secrets } = context;
    const url =
        `${baseUrl(context)}/products/v4/search/` +
        `${encodeURIComponent(partNumber.trim())}/productdetails`;
    for (let attempt = 0; ; attempt++) {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${await accessToken(context)}`,
            "X-DIGIKEY-Client-Id": secrets.clientId ?? "",
            "X-DIGIKEY-Locale-Site": String(config.site),
            "X-DIGIKEY-Locale-Language": "en",
            "X-DIGIKEY-Locale-Currency": String(config.currency),
            Accept: "application/json"
        };
        if (secrets.accountId) {
            headers["X-DIGIKEY-Account-Id"] = secrets.accountId;
        }
        const response = await context.http.request({
            method: "GET",
            url,
            headers
        });
        const remaining = Number(response.headers.get("x-ratelimit-remaining"));
        if (
            response.headers.has("x-ratelimit-remaining") &&
            Number.isFinite(remaining)
        ) {
            context.reportRemaining(remaining);
        }

        switch (response.status) {
            case 200:
                return parseProductDetails(
                    partNumber,
                    response.json(),
                    String(config.currency)
                );
            case 404:
                return { status: "notFound" };
            case 400:
                return {
                    status: "error",
                    message:
                        `DigiKey couldn't search for this part number. ${problemDetail(response.text)}`.trim()
                };
            case 401:
                tokens.delete(tokenKey(context));
                if (attempt === 0) {
                    continue; // the token may have just expired
                }
                throw new AuthError(
                    "DigiKey refused access. Check the client ID and secret in Settings."
                );
            case 403:
                throw new AuthError(
                    "DigiKey refused access (HTTP 403). Check that the app is " +
                        "subscribed to Product Information v4. After too many " +
                        "requests in a short time, DigiKey blocks access for 10 minutes."
                );
            case 429:
                if (/daily/i.test(response.text)) {
                    throw new QuotaExceededError(
                        "DigiKey's daily request limit is reached."
                    );
                }
                throw new ThrottledError(
                    "Too many requests.",
                    retryAfterMs(response.headers) ?? 60_000
                );
            default:
                throw new SupplierError(`DigiKey: HTTP ${response.status}.`);
        }
    }
}

/** Exported for tests. */
export function parseProductDetails(
    partNumber: string,
    body: unknown,
    requestedCurrency: string
): LookupOutcome {
    const parsed = productDetailsSchema.safeParse(body);
    if (!parsed.success) {
        throw new SupplierError("Unexpected answer from DigiKey.");
    }
    const details = parsed.data;
    const currency = normalizeCurrency(
        details.SearchLocaleUsed?.Currency ?? requestedCurrency
    );
    const offers = (details.Product.ProductVariations ?? []).map(variation =>
        toOffer(details, variation, currency)
    );
    // Stock is per packaging: mention the others that have some, e.g. a
    // box in stock when cut tape is out of stock.
    for (const offer of offers) {
        const others = offers.filter(
            other => other !== offer && other.stockQty > 0
        );
        if (others.length > 0) {
            offer.notes = [
                ...(offer.notes ?? []),
                ...others.map(otherPackagingNote)
            ];
        }
    }
    // The product holds all packagings (cut tape, reel, Digi-Reel); the one
    // whose number was asked for is the match. If DigiKey found the product
    // some other way, the user picks the packaging.
    return matchOutcome(partNumber, offers, { askWhenUnsure: true });
}

function toOffer(
    details: ProductDetails,
    variation: z.infer<typeof variationSchema>,
    currency: string
): SupplierOffer {
    const product = details.Product;
    const mine = variation.MyPricing ?? [];
    const prices = mine.length > 0 ? mine : (variation.StandardPricing ?? []);
    const packaging = variation.PackageType?.Name ?? undefined;
    const notes: string[] = [];
    if (
        packaging?.toLowerCase().includes("digi-reel") ||
        (variation.DigiReelFee ?? 0) > 0
    ) {
        notes.push("Digi-Reel: DigiKey adds a reeling fee to the price.");
    }
    return {
        supplierPartNumber: variation.DigiKeyProductNumber,
        manufacturer: product.Manufacturer?.Name ?? "",
        manufacturerPartNumber: product.ManufacturerProductNumber ?? "",
        description: product.Description?.ProductDescription ?? "",
        packaging,
        stockQty:
            variation.QuantityAvailableforPackageType ??
            product.QuantityAvailable ??
            0,
        moq: variation.MinimumOrderQuantity || 1,
        // DigiKey v4 has no order multiple.
        orderMultiple: 1,
        priceBreaks: sortBreaks(
            prices.map(item => ({
                qty: item.BreakQuantity,
                unitPrice: item.UnitPrice
            }))
        ),
        priceKind: mine.length > 0 ? "account" : "list",
        currency,
        lifecycle: digikeyLifecycle(product.ProductStatus?.Status),
        lifecycleRaw: product.ProductStatus?.Status ?? null,
        rohs: product.Classifications?.RohsStatus ?? null,
        productUrl: product.ProductUrl ?? undefined,
        datasheetUrl: product.DatasheetUrl ?? undefined,
        notes: notes.length > 0 ? notes : undefined
    };
}

function tokenKey(context: SupplierContext): string {
    return `${baseUrl(context)}|${context.secrets.clientId}`;
}

async function accessToken(context: SupplierContext): Promise<string> {
    const cached = tokens.get(tokenKey(context));
    if (cached && cached.expiresAt > Date.now() + 30_000) {
        return cached.token;
    }
    const response = await context.http.request({
        method: "POST",
        url: `${baseUrl(context)}/v1/oauth2/token`,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
        },
        body: new URLSearchParams({
            client_id: context.secrets.clientId ?? "",
            client_secret: context.secrets.clientSecret ?? "",
            grant_type: "client_credentials"
        }).toString()
    });
    if ([400, 401, 403].includes(response.status)) {
        throw new AuthError(
            "DigiKey rejected the client ID and secret. Check them in Settings."
        );
    }
    const parsed = tokenSchema.safeParse(safeJson(response.text));
    if (response.status !== 200 || !parsed.success) {
        throw new SupplierError(
            `DigiKey sign-in failed (HTTP ${response.status}).`
        );
    }
    const { access_token: token, expires_in: seconds = 600 } = parsed.data;
    context.addSecret(token);
    tokens.set(tokenKey(context), {
        token,
        expiresAt: Date.now() + seconds * 1000
    });
    return token;
}

/** The `detail` of an RFC 7807 problem response, if there is one. */
function problemDetail(text: string): string {
    const body = safeJson(text) as { detail?: unknown } | undefined;
    return typeof body?.detail === "string" ? body.detail : "";
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}
