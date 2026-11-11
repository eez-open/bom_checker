// LCSC API (the "agent" API, lcsc.com/agent). One part number per lookup:
// product details for LCSC numbers (C2040), a keyword search for
// manufacturer part numbers. Every request is signed with the key and
// secret, and LCSC accepts calls only from the IP addresses registered for
// the account; Settings → API address can send them through a relay on a
// server with such an address.
// https://www.lcsc.com/agent (API guide: "Authentication and Access Control")

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { lcscLifecycle } from "../../shared/lifecycle";
import {
    partNumberKey,
    type LookupOutcome,
    type SupplierOffer
} from "../../shared/model";
import { retryAfterMs } from "../collection/http";
import {
    matchOutcome,
    normalizeCurrency,
    sortBreaks,
    toInteger
} from "./matching";
import {
    AuthError,
    QuotaExceededError,
    SupplierError,
    ThrottledError,
    type SupplierContext,
    type SupplierPlugin
} from "./types";

const PRODUCTION_URL = "https://api.lcsc.com";
const SANDBOX_URL = "https://sandbox-api.lcsc.com";
const DETAILS_PATH = "/rest/api/agent/product/v1/productdetails";
const SEARCH_PATH = "/rest/api/agent/product/v1/keywordsearch";

/** Search results checked for a manufacturer part number. */
const SEARCH_LIMIT = 20;
const LCSC_NUMBER = /^C\d+$/i;

const numberOrText = z.union([z.number(), z.string()]).nullish();

const productSchema = z.looseObject({
    lcscProductNumber: z.string().nullish(),
    manufacturerProductNumber: z.string().nullish(),
    manufacturer: z.looseObject({ name: z.string().nullish() }).nullish(),
    description: z.string().nullish(),
    packageType: z.string().nullish(),
    minimumOrderQuantity: numberOrText,
    incrementQuantity: numberOrText,
    isOnSale: z.boolean().nullish(),
    productDetailURL: z.string().nullish(),
    datasheetURL: z.string().nullish(),
    productParameters: z.record(z.string(), z.unknown()).nullish(),
    productPrice: z
        .looseObject({
            currency: z.string().nullish(),
            quantityAvailable: numberOrText,
            standardPricing: z
                .array(
                    z.looseObject({
                        breakQuantity: numberOrText,
                        unitPrice: numberOrText
                    })
                )
                .nullish()
        })
        .nullish()
});

const envelopeSchema = z.looseObject({
    code: z.number().nullish(),
    message: z.string().nullish(),
    success: z.boolean().nullish(),
    result: z.unknown().optional()
});

const productListSchema = z.looseObject({
    products: z.array(productSchema).nullish()
});

type LcscProduct = z.infer<typeof productSchema>;

export const lcsc: SupplierPlugin = {
    id: "lcsc",
    batchSize: 1,
    requestsPerBatch: 1,
    requiredSecrets: ["apiKey", "apiSecret"],
    testPartNumber: "C2040",

    async lookup(partNumbers, context) {
        const outcomes = new Map<string, LookupOutcome>();
        for (const partNumber of partNumbers) {
            outcomes.set(
                partNumberKey(partNumber),
                await lookupOne(partNumber.trim(), context)
            );
        }
        return outcomes;
    }
};

async function lookupOne(
    partNumber: string,
    context: SupplierContext
): Promise<LookupOutcome> {
    const currency = String(context.config.currency);
    if (LCSC_NUMBER.test(partNumber)) {
        const result = await call(
            context,
            DETAILS_PATH,
            {
                lcscProductNumber: partNumber.toUpperCase(),
                returnInformation: "All",
                currency
            },
            "details"
        );
        const product = productSchema.safeParse(result);
        if (!result || !product.success) {
            return { status: "notFound" };
        }
        return matchOutcome(partNumber, [
            toOffer(await withPrices(product.data, context))
        ]);
    }

    // Not an LCSC number: search for it as a manufacturer part number.
    const result = await call(
        context,
        SEARCH_PATH,
        {
            keyword: partNumber,
            limit: String(SEARCH_LIMIT),
            returnInformation: "All",
            currency
        },
        "search"
    );
    const products = productListSchema.safeParse(result ?? {});
    if (!products.success) {
        throw new SupplierError("Unexpected answer from LCSC.");
    }
    const outcome = matchOutcome(
        partNumber,
        (products.data.products ?? []).map(toOffer)
    );
    if (
        outcome.status === "found" &&
        outcome.offer.currency !== normalizeCurrency(currency)
    ) {
        const product = (products.data.products ?? []).find(
            p => p.lcscProductNumber === outcome.offer.supplierPartNumber
        );
        if (product) {
            return {
                ...outcome,
                offer: toOffer(await withPrices(product, context))
            };
        }
    }
    return outcome;
}

/**
 * LCSC's guide says the currency applies only when asking for prices
 * alone. If the full answer has prices in another currency, they are asked
 * for again on their own.
 */
async function withPrices(
    product: LcscProduct,
    context: SupplierContext
): Promise<LcscProduct> {
    const currency = String(context.config.currency);
    if (
        normalizeCurrency(product.productPrice?.currency) ===
            normalizeCurrency(currency) ||
        !product.lcscProductNumber
    ) {
        return product;
    }
    const pricing = productSchema.safeParse(
        await call(
            context,
            DETAILS_PATH,
            {
                lcscProductNumber: product.lcscProductNumber,
                returnInformation: "ProductPricing",
                currency
            },
            "details"
        )
    );
    return pricing.success && pricing.data.productPrice
        ? { ...product, productPrice: pricing.data.productPrice }
        : product;
}

async function call(
    context: SupplierContext,
    path: string,
    params: Record<string, string>,
    kind: "details" | "search"
): Promise<unknown> {
    const { query, headers } = signRequest(
        params,
        context.secrets.apiKey ?? "",
        context.secrets.apiSecret ?? "",
        Date.now(),
        randomUUID().replaceAll("-", "")
    );
    // Settings → API address: a relay on a server whose IP address LCSC
    // accepts, e.g. an Apache reverse proxy (docs/user-guide.md).
    const relay = String(context.config.apiAddress ?? "").replace(/\/+$/, "");
    const base = context.baseUrl(
        relay ||
            (context.config.environment === "sandbox"
                ? SANDBOX_URL
                : PRODUCTION_URL)
    );
    const response = await context.http.request({
        method: "GET",
        url: `${base}${path}?${query}`,
        headers
    });
    let body: unknown = null;
    try {
        body = response.json();
    } catch {
        // Not JSON; checkResponse reports it unless the status explains it.
    }
    return checkResponse(response.status, response.headers, body, kind);
}

/** Java's URLEncoder, which LCSC uses to check signatures: a space becomes
 *  "+", and only letters, digits and "*-._" stay as they are. */
export function lcscEncode(value: string): string {
    return encodeURIComponent(value)
        .replace(
            /[!'()~]/g,
            c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
        )
        .replace(/%20/g, "+");
}

/** The query string and headers of a signed request. */
export function signRequest(
    params: Record<string, string>,
    key: string,
    secret: string,
    now: number,
    nonce: string
): { query: string; headers: Record<string, string> } {
    const query = Object.keys(params)
        .sort()
        .map(name => `${lcscEncode(name)}=${lcscEncode(params[name]!)}`)
        .join("&");
    const timestamp = String(Math.floor(now / 1000));
    const signed =
        `key=${key}&nonce=${nonce}&secret=${secret}&timestamp=${timestamp}` +
        (query ? `&${query}` : "");
    return {
        query,
        headers: {
            key,
            nonce,
            timestamp,
            signature: createHash("sha256")
                .update(signed, "utf8")
                .digest("hex"),
            Accept: "application/json"
        }
    };
}

/**
 * The `result` of a successful answer; null when the product doesn't
 * exist. Exported for tests. LCSC reports most problems with HTTP 200 and a
 * business code: 4001 (missing header) and 4003 (unknown key, expired
 * timestamp, wrong signature).
 */
export function checkResponse(
    status: number,
    headers: Headers,
    body: unknown,
    kind: "details" | "search"
): unknown {
    if (status === 401) {
        throw new AuthError(
            "LCSC refused the request (HTTP 401). LCSC only accepts calls from " +
                "the public IP addresses registered for your account; register " +
                "this network's address at lcsc.com/agent."
        );
    }
    const parsed = envelopeSchema.safeParse(body);
    const code = parsed.success ? parsed.data.code : null;
    if (status === 430 || code === 430) {
        throw new QuotaExceededError("LCSC's daily request limit is reached.");
    }
    if (status === 429 || code === 429) {
        throw new ThrottledError(
            "Too many requests per minute.",
            retryAfterMs(headers) ?? 60_000
        );
    }
    if (!parsed.success) {
        throw new SupplierError(
            `Unexpected answer from LCSC (HTTP ${status}).`
        );
    }
    const { success, message, result } = parsed.data;
    if (success === true || code === 200) {
        return result ?? null;
    }
    if (code === 4001 || code === 4003) {
        throw new AuthError(
            `LCSC rejected the request: ${message ?? `code ${code}`}. ` +
                "Check the key and secret in Settings, the environment " +
                "(new keys work only in the sandbox at first), and that " +
                "this computer's clock is correct."
        );
    }
    if (
        kind === "details" &&
        /not (be )?found|not exist|no (such )?product/i.test(message ?? "")
    ) {
        return null;
    }
    throw new SupplierError(`LCSC: ${message ?? `code ${code ?? status}`}`);
}

function toOffer(product: LcscProduct): SupplierOffer {
    const price = product.productPrice;
    const priceBreaks = sortBreaks(
        (price?.standardPricing ?? []).flatMap(priceBreak => {
            const qty = toInteger(priceBreak.breakQuantity);
            const unitPrice = Number(priceBreak.unitPrice);
            return qty && Number.isFinite(unitPrice) && unitPrice > 0
                ? [{ qty, unitPrice }]
                : [];
        })
    );
    // Parameter values are text, e.g. { "RoHS": "Yes" }.
    const rohs = Object.entries(product.productParameters ?? {}).find(
        ([name, value]) => /rohs/i.test(name) && typeof value === "string"
    )?.[1] as string | undefined;
    return {
        supplierPartNumber: product.lcscProductNumber ?? "",
        manufacturer: product.manufacturer?.name ?? "",
        manufacturerPartNumber: product.manufacturerProductNumber ?? "",
        description: product.description ?? "",
        packaging: product.packageType || undefined,
        stockQty: toInteger(price?.quantityAvailable) ?? 0,
        moq: toInteger(product.minimumOrderQuantity) || 1,
        orderMultiple: toInteger(product.incrementQuantity) || 1,
        priceBreaks,
        // LCSC's "standard pricing"; it has no account-specific prices.
        priceKind: "list",
        currency: normalizeCurrency(price?.currency),
        lifecycle: lcscLifecycle(product.isOnSale),
        lifecycleRaw: product.isOnSale === false ? "Not on sale" : null,
        rohs: rohs ?? null,
        productUrl: product.productDetailURL || undefined,
        datasheetUrl: product.datasheetURL || undefined
    };
}
