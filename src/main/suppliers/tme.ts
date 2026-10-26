// TME API v2 (OAuth 2.0 client credentials with the user's private key, so
// the account's own prices are returned). Up to 50 symbols per request;
// a batch takes two requests: products, then prices and stock.
// https://developers.tme.eu/en/api-doc/v2

import { z } from "zod";
import { tmeLifecycle } from "../../shared/lifecycle";
import {
    partNumberKey,
    type LookupOutcome,
    type SupplierOffer
} from "../../shared/model";
import { retryAfterMs } from "../collection/http";
import { matchOutcome, normalizeCurrency, sortBreaks } from "./matching";
import {
    AuthError,
    SupplierError,
    ThrottledError,
    type SupplierContext,
    type SupplierPlugin
} from "./types";

const DEFAULT_URL = "https://api.tme.eu";

const tokenSchema = z.looseObject({
    access_token: z.string(),
    expires_in: z.number().optional()
});

const envelopeSchema = z.looseObject({
    status: z.string().nullish(),
    code: z.string().nullish(),
    message: z.string().nullish(),
    data: z.unknown().optional()
});

const productSchema = z.looseObject({
    symbol: z.string(),
    manufacturer: z.looseObject({ name: z.string().nullish() }).nullish(),
    manufacturer_symbols: z.array(z.string()).nullish(),
    description: z.string().nullish(),
    minimal_amount: z.number().nullish(),
    multiples: z.number().nullish(),
    product_status: z.array(z.string()).nullish()
});

const productDataSchema = z.looseObject({
    symbol: z.string(),
    stock_quantity: z.number().nullish(),
    prices: z
        .looseObject({
            elements: z
                .array(
                    z.looseObject({
                        amount: z.number(),
                        price: z.number(),
                        special: z.boolean().nullish()
                    })
                )
                .nullish(),
            currency: z.string().nullish(),
            type: z.string().nullish()
        })
        .nullish()
});

const elementsSchema = <T extends z.ZodType>(element: T) =>
    z.looseObject({ elements: z.array(element) });

type Product = z.infer<typeof productSchema>;
type ProductData = z.infer<typeof productDataSchema>;

/** TME rejected the parameters, e.g. one symbol in the batch is invalid. */
class InvalidInputError extends Error {}

const tokens = new Map<string, { token: string; expiresAt: number }>();

export const tme: SupplierPlugin = {
    id: "tme",
    batchSize: 50,
    requestsPerBatch: 2,
    requiredSecrets: ["token", "appSecret"],
    testPartNumber: "1N4007-DIO",

    async lookup(partNumbers, context) {
        const symbols = [...new Set(partNumbers.map(toSymbol))];
        const invalid = new Set<string>();
        const products = await splitOnInvalid(
            symbols,
            batch => getProducts(context, "symbols[]", batch),
            invalid
        );

        // Cells may hold a manufacturer part number instead of a TME symbol.
        const known = new Set(products.map(p => toSymbol(p.symbol)));
        const unknown = symbols.filter(s => !known.has(s) && !invalid.has(s));
        const byManufacturer =
            unknown.length > 0
                ? await splitOnInvalid(
                      unknown,
                      batch => getProducts(context, "mpns[]", batch),
                      new Set()
                  )
                : [];

        const all = new Map<string, Product>();
        for (const product of [...products, ...byManufacturer]) {
            all.set(toSymbol(product.symbol), product);
        }
        const data = new Map<string, ProductData>();
        if (all.size > 0) {
            const found = await splitOnInvalid(
                [...all.keys()],
                batch => getProductData(context, batch),
                new Set()
            );
            for (const item of found) {
                data.set(toSymbol(item.symbol), item);
            }
        }

        const unknownKeys = new Set(unknown.map(partNumberKey));
        const offers = [...all.values()].map(product =>
            toOffer(
                product,
                data.get(toSymbol(product.symbol)),
                context,
                unknownKeys
            )
        );
        return new Map(
            partNumbers.map((pn): [string, LookupOutcome] => [
                partNumberKey(pn),
                invalid.has(toSymbol(pn))
                    ? {
                          status: "error",
                          message: "TME doesn't accept this part number."
                      }
                    : matchOutcome(pn, offers)
            ])
        );
    }
};

function toSymbol(partNumber: string): string {
    return partNumber.trim().toUpperCase();
}

/** Runs `request` for all items. When TME rejects a batch because of an
 *  invalid item, splits it in halves to find and skip that item. */
async function splitOnInvalid<T>(
    items: string[],
    request: (batch: string[]) => Promise<T[]>,
    invalid: Set<string>
): Promise<T[]> {
    try {
        return await request(items);
    } catch (error) {
        if (!(error instanceof InvalidInputError)) {
            throw error;
        }
        if (items.length === 1) {
            invalid.add(items[0]!);
            return [];
        }
        const middle = Math.ceil(items.length / 2);
        return [
            ...(await splitOnInvalid(items.slice(0, middle), request, invalid)),
            ...(await splitOnInvalid(items.slice(middle), request, invalid))
        ];
    }
}

async function getProducts(
    context: SupplierContext,
    parameter: "symbols[]" | "mpns[]",
    values: string[]
): Promise<Product[]> {
    const data = await call(context, "/products", [
        ...values.map((value): [string, string] => [parameter, value]),
        ["country", String(context.config.country)]
    ]);
    return parseElements(elementsSchema(productSchema), data);
}

async function getProductData(
    context: SupplierContext,
    symbols: string[]
): Promise<ProductData[]> {
    const data = await call(context, "/products/data", [
        ...symbols.map((symbol): [string, string] => ["symbols[]", symbol]),
        ["scope[]", "prices"],
        ["scope[]", "stock"],
        ["currency", String(context.config.currency)],
        ["country", String(context.config.country)]
    ]);
    return parseElements(elementsSchema(productDataSchema), data);
}

function parseElements<T>(
    schema: z.ZodType<{ elements: T[] }>,
    data: unknown
): T[] {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
        throw new SupplierError("Unexpected answer from TME.");
    }
    return parsed.data.elements;
}

/** A GET request with the access token; returns the response's `data`. */
async function call(
    context: SupplierContext,
    path: string,
    parameters: [string, string][]
): Promise<unknown> {
    const base = context.baseUrl(DEFAULT_URL);
    for (let attempt = 0; ; attempt++) {
        const token = await accessToken(context);
        const response = await context.http.request({
            method: "GET",
            url: `${base}${path}?${new URLSearchParams(parameters).toString()}`,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
                "Accept-Language": String(context.config.language).toLowerCase()
            }
        });
        const parsed = envelopeSchema.safeParse(safeJson(response.text));
        const body = parsed.success ? parsed.data : {};
        if (response.status === 401 || response.status === 403) {
            // The token may have just expired; get a new one once.
            tokens.delete(tokenKey(context));
            if (attempt === 0) {
                continue;
            }
            throw new AuthError(
                "TME refused access. Check the token and app secret in Settings."
            );
        }
        if (response.status === 429) {
            throw new ThrottledError(
                "Too many requests.",
                retryAfterMs(response.headers) ?? 2000
            );
        }
        if (body.code === "E_INPUT_PARAMS_VALIDATION_ERROR") {
            throw new InvalidInputError(body.message ?? "Invalid input");
        }
        if (response.status !== 200 || body.status !== "OK") {
            throw new SupplierError(
                `TME: ${body.message ?? body.code ?? `HTTP ${response.status}`}`
            );
        }
        return body.data;
    }
}

function tokenKey(context: SupplierContext): string {
    return `${context.baseUrl(DEFAULT_URL)}|${context.secrets.token}`;
}

async function accessToken(context: SupplierContext): Promise<string> {
    const cached = tokens.get(tokenKey(context));
    if (cached && cached.expiresAt > Date.now() + 30_000) {
        return cached.token;
    }
    const credentials = Buffer.from(
        `${context.secrets.token}:${context.secrets.appSecret}`
    ).toString("base64");
    context.addSecret(credentials);
    const response = await context.http.request({
        method: "POST",
        url: `${context.baseUrl(DEFAULT_URL)}/auth/token`,
        headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
        },
        body: "grant_type=client_credentials"
    });
    if ([400, 401, 403].includes(response.status)) {
        throw new AuthError(
            "TME rejected the token and app secret. Check them in Settings."
        );
    }
    const parsed = tokenSchema.safeParse(safeJson(response.text));
    if (response.status !== 200 || !parsed.success) {
        throw new SupplierError(
            `TME sign-in failed (HTTP ${response.status}).`
        );
    }
    const { access_token: token, expires_in: seconds = 300 } = parsed.data;
    context.addSecret(token);
    tokens.set(tokenKey(context), {
        token,
        expiresAt: Date.now() + seconds * 1000
    });
    return token;
}

function toOffer(
    product: Product,
    data: ProductData | undefined,
    context: SupplierContext,
    requestedKeys: ReadonlySet<string>
): SupplierOffer {
    const manufacturerSymbols = product.manufacturer_symbols ?? [];
    const prices = data?.prices;
    const breaks = prices?.elements ?? [];
    const notes: string[] = [];
    if (prices?.type?.toUpperCase() === "GROSS") {
        notes.push("Prices include VAT (set in your TME account).");
    }
    if (breaks.some(item => item.special)) {
        notes.push("Includes special prices for your account.");
    }
    const status = product.product_status ?? [];
    const country = String(context.config.country).toLowerCase();
    const urlSymbol = encodeURIComponent(
        product.symbol.toLowerCase().replace(/\//g, "_")
    );
    return {
        supplierPartNumber: product.symbol,
        manufacturer: product.manufacturer?.name ?? "",
        // When found by manufacturer part number, report the one asked for.
        manufacturerPartNumber:
            manufacturerSymbols.find(mpn =>
                requestedKeys.has(partNumberKey(mpn))
            ) ??
            manufacturerSymbols[0] ??
            "",
        description: product.description ?? "",
        stockQty: data?.stock_quantity ?? 0,
        moq: product.minimal_amount || 1,
        orderMultiple: product.multiples || 1,
        priceBreaks: sortBreaks(
            breaks.map(item => ({ qty: item.amount, unitPrice: item.price }))
        ),
        // A private key returns the account's own price list.
        priceKind: "account",
        currency: normalizeCurrency(
            prices?.currency ?? String(context.config.currency)
        ),
        lifecycle: tmeLifecycle(status),
        lifecycleRaw: status.length > 0 ? status.join(", ") : null,
        // TME's API has no RoHS information.
        rohs: null,
        productUrl: `https://www.tme.eu/${country}/details/${urlSymbol}/`,
        notes: notes.length > 0 ? notes : undefined
    };
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}
