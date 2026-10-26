// Mouser Search API v1, part number search. Up to 10 part numbers per
// request; the key is passed as a query parameter (never logged).
// https://api.mouser.com/api/docs/ui/index?urls.primaryName=api%2Fdocs%2FV1

import { z } from "zod";
import { mouserLifecycle } from "../../shared/lifecycle";
import {
    partNumberKey,
    type LookupOutcome,
    type SupplierOffer
} from "../../shared/model";
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
    type SupplierPlugin
} from "./types";

const DEFAULT_URL = "https://api.mouser.com";

const numberOrText = z.union([z.string(), z.number()]).nullish();

const partSchema = z.looseObject({
    MouserPartNumber: z.string().nullish(),
    Manufacturer: z.string().nullish(),
    ManufacturerPartNumber: z.string().nullish(),
    Description: z.string().nullish(),
    AvailabilityInStock: numberOrText,
    Min: numberOrText,
    Mult: numberOrText,
    PriceBreaks: z
        .array(
            z.looseObject({
                Quantity: z.number(),
                Price: z.union([z.string(), z.number()]),
                Currency: z.string().nullish()
            })
        )
        .nullish(),
    LifecycleStatus: z.string().nullish(),
    IsDiscontinued: z.union([z.string(), z.boolean()]).nullish(),
    ROHSStatus: z.string().nullish(),
    ProductDetailUrl: z.string().nullish(),
    DataSheetUrl: z.string().nullish(),
    RestrictionMessage: z.string().nullish(),
    ProductAttributes: z
        .array(
            z.looseObject({
                AttributeName: z.string().nullish(),
                AttributeValue: z.string().nullish()
            })
        )
        .nullish()
});

const responseSchema = z.looseObject({
    Errors: z
        .array(
            z.looseObject({
                Code: z.string().nullish(),
                Message: z.string().nullish(),
                ResourceKey: z.string().nullish(),
                PropertyName: z.string().nullish()
            })
        )
        .nullish(),
    SearchResults: z
        .looseObject({ Parts: z.array(partSchema).nullish() })
        .nullish()
});

type MouserPart = z.infer<typeof partSchema>;

export const mouser: SupplierPlugin = {
    id: "mouser",
    batchSize: 10,
    requestsPerBatch: 1,
    requiredSecrets: ["apiKey"],
    testPartNumber: "595-TPS54331DDA",

    async lookup(partNumbers, context) {
        const apiKey = encodeURIComponent(context.secrets.apiKey ?? "");
        const response = await context.http.request({
            method: "POST",
            url: `${context.baseUrl(DEFAULT_URL)}/api/v1/search/partnumber?apiKey=${apiKey}`,
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify({
                SearchByPartRequest: {
                    mouserPartNumber: partNumbers
                        .map(pn => pn.trim())
                        .join("|"),
                    partSearchOptions: "Exact"
                }
            })
        });
        return parseMouserResponse(
            partNumbers,
            response.status,
            response.json()
        );
    }
};

/** Exported for tests. */
export function parseMouserResponse(
    partNumbers: readonly string[],
    status: number,
    body: unknown
): Map<string, LookupOutcome> {
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
        throw new SupplierError(
            `Unexpected answer from Mouser (HTTP ${status}).`
        );
    }
    const { Errors: errors, SearchResults: results } = parsed.data;

    // Mouser reports limits and bad keys in "Errors", sometimes with HTTP
    // 200, so these are checked before the status.
    for (const error of errors ?? []) {
        const text = `${error.Code ?? ""} ${error.ResourceKey ?? ""} ${error.Message ?? ""}`;
        if (/TooManyRequests/i.test(text)) {
            if (/per ?day|MaxCallPerDay/i.test(text)) {
                throw new QuotaExceededError(
                    "Mouser's daily request limit is reached."
                );
            }
            throw new ThrottledError("Too many requests per minute.", 60_000);
        }
        if (/InvalidIdentifier|API Key/i.test(text)) {
            throw new AuthError(
                "Mouser rejected the API key. Check the Search API key in Settings."
            );
        }
    }
    if (status === 401 || status === 403) {
        throw new AuthError(`Mouser refused the request (HTTP ${status}).`);
    }
    if (status !== 200 || !results) {
        const message = errors?.[0]?.Message ?? `HTTP ${status}`;
        throw new SupplierError(`Mouser: ${message}`);
    }

    const offers = (results.Parts ?? [])
        .filter(
            part => part.MouserPartNumber && part.MouserPartNumber !== "N/A"
        )
        .map(toOffer);
    return new Map(
        partNumbers.map(pn => [partNumberKey(pn), matchOutcome(pn, offers)])
    );
}

function toOffer(part: MouserPart): SupplierOffer {
    const currency = normalizeCurrency(part.PriceBreaks?.[0]?.Currency);
    const priceBreaks = sortBreaks(
        (part.PriceBreaks ?? []).flatMap(breakQty => {
            const unitPrice = parsePrice(breakQty.Price, currency);
            return unitPrice === null
                ? []
                : [{ qty: breakQty.Quantity, unitPrice }];
        })
    );
    const discontinued =
        String(part.IsDiscontinued ?? "").toLowerCase() === "true";
    const packaging = part.ProductAttributes?.filter(
        attribute => attribute.AttributeName === "Packaging"
    )
        .map(attribute => attribute.AttributeValue)
        .filter(Boolean)
        .join(", ");
    return {
        supplierPartNumber: part.MouserPartNumber ?? "",
        manufacturer: part.Manufacturer ?? "",
        manufacturerPartNumber: part.ManufacturerPartNumber ?? "",
        description: part.Description ?? "",
        packaging: packaging || undefined,
        stockQty: toInteger(part.AvailabilityInStock) ?? 0,
        moq: toInteger(part.Min) || 1,
        orderMultiple: toInteger(part.Mult) || 1,
        priceBreaks,
        // Mouser doesn't say whether prices are specific to the account.
        priceKind: "unknown",
        currency,
        lifecycle: mouserLifecycle(part.LifecycleStatus, discontinued),
        lifecycleRaw:
            part.LifecycleStatus ?? (discontinued ? "Discontinued" : null),
        rohs: part.ROHSStatus ?? null,
        productUrl: part.ProductDetailUrl || undefined,
        datasheetUrl: part.DataSheetUrl || undefined,
        notes: part.RestrictionMessage ? [part.RestrictionMessage] : undefined
    };
}

// Currencies whose prices use "," only as a thousands separator.
const COMMA_THOUSANDS = new Set([
    "USD",
    "GBP",
    "CNY",
    "JPY",
    "INR",
    "AUD",
    "CAD"
]);

/**
 * Mouser formats prices for the account's locale: "6,85 €", "€ 2,10",
 * "$1,234.50", "¥18.6111". The last separator is the decimal point; a lone
 * comma is a decimal comma except in currencies that use it for thousands.
 */
export function parsePrice(
    value: string | number,
    currency: string
): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    let text = value.replace(/[^\d.,]/g, "");
    const lastDot = text.lastIndexOf(".");
    const lastComma = text.lastIndexOf(",");
    if (lastDot >= 0 && lastComma >= 0) {
        text =
            lastDot > lastComma
                ? text.replace(/,/g, "")
                : text.replace(/\./g, "").replace(",", ".");
    } else if (lastComma >= 0) {
        const single = text.indexOf(",") === lastComma;
        text =
            single && !COMMA_THOUSANDS.has(currency)
                ? text.replace(",", ".")
                : text.replace(/,/g, "");
    } else if (text.indexOf(".") !== lastDot) {
        text = text.replace(/\./g, ""); // "1.234.567"
    }
    const number = Number(text);
    return text !== "" && Number.isFinite(number) ? number : null;
}
