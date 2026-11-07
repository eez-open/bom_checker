// Arrow Pricing & Availability API (itemservice v4), search by list (#62).
// Arrow has inventory sources (EUROPE, ACNA, ASIA, VERICAL…), each a
// supplier of its own in the BOM, e.g. "Arrow (EUROPE)", sharing Arrow's
// settings. Every request answers for all sources; each supplier takes
// the offers of its own. Login and key go in the query (never logged).
// Arrow's terms allow keeping its data for 48 hours (SUPPLIERS.maxAgeMs).
// https://developers.arrow.com/api/index.php/site/page?view=v4isSearchList
// Built from Arrow's documentation; to be confirmed with live data.

import { networkInterfaces } from "node:os";
import { z } from "zod";
import { arrowLifecycle } from "../../shared/lifecycle";
import {
    partNumberKey,
    type LookupOutcome,
    type SupplierId,
    type SupplierOffer
} from "../../shared/model";
import { SUPPLIERS } from "../../shared/suppliers";
import { normalizeCurrency, sortBreaks, toInteger } from "./matching";
import {
    AuthError,
    SupplierError,
    ThrottledError,
    type SupplierPlugin
} from "./types";

const DEFAULT_URL = "https://api.arrow.com";

/** Part numbers per request when the setting is missing. */
const DEFAULT_BATCH = 100;

const numberOrText = z.union([z.number(), z.string()]).nullish();

const resourceSchema = z.looseObject({
    type: z.string().nullish(),
    uri: z.string().nullish()
});

const priceSchema = z.looseObject({
    price: numberOrText,
    displayPrice: z.string().nullish(),
    minQty: numberOrText
});

const sourcePartSchema = z.looseObject({
    packSize: numberOrText,
    minimumOrderQuantity: numberOrText,
    Prices: z
        .looseObject({ resaleList: z.array(priceSchema).nullish() })
        .nullish(),
    Availability: z
        .array(
            z.looseObject({
                fohQty: numberOrText,
                availabilityMessage: z.string().nullish()
            })
        )
        .nullish(),
    containerType: z.string().nullish(),
    resources: z.array(resourceSchema).nullish(),
    isNcnr: z.boolean().nullish(),
    shipsFrom: z.string().nullish(),
    shipsIn: z.string().nullish()
});

const sourceSchema = z.looseObject({
    currency: z.string().nullish(),
    sourceCd: z.string().nullish(),
    displayName: z.string().nullish(),
    sourceParts: z.array(sourcePartSchema).nullish()
});

const partSchema = z.looseObject({
    partNum: z.string().nullish(),
    manufacturer: z.looseObject({ mfrName: z.string().nullish() }).nullish(),
    desc: z.string().nullish(),
    status: z.string().nullish(),
    resources: z.array(resourceSchema).nullish(),
    EnvData: z
        .looseObject({
            compliance: z
                .array(
                    z.looseObject({
                        displayLabel: z.string().nullish(),
                        displayValue: z.string().nullish()
                    })
                )
                .nullish()
        })
        .nullish(),
    InvOrg: z
        .looseObject({
            webSites: z
                .array(
                    z.looseObject({ sources: z.array(sourceSchema).nullish() })
                )
                .nullish(),
            // Version 3 had the sources here.
            sources: z.array(sourceSchema).nullish()
        })
        .nullish()
});

const responseSchema = z.looseObject({
    itemserviceresult: z.looseObject({
        transactionArea: z
            .array(
                z.looseObject({
                    response: z
                        .looseObject({
                            returnCode: numberOrText,
                            returnMsg: z.string().nullish(),
                            success: z
                                .union([z.boolean(), z.string()])
                                .nullish()
                        })
                        .nullish()
                })
            )
            .nullish(),
        // The documentation shows data[].PartList; list searches answer
        // with data[].resultList[], one entry per part number asked for.
        data: z
            .array(
                z.looseObject({
                    PartList: z.array(partSchema).nullish(),
                    resultList: z
                        .array(
                            z.looseObject({
                                requestedPartNum: z.string().nullish(),
                                PartList: z.array(partSchema).nullish()
                            })
                        )
                        .nullish()
                })
            )
            .nullish()
    })
});

type ArrowPart = z.infer<typeof partSchema>;
type ArrowSource = z.infer<typeof sourceSchema>;
type ArrowSourcePart = z.infer<typeof sourcePartSchema>;
type ArrowPrice = z.infer<typeof priceSchema>;

/** This computer's address, which list searches must give ("remoteIp"). */
function localAddress(): string {
    for (const addresses of Object.values(networkInterfaces())) {
        const external = addresses?.find(
            address => address.family === "IPv4" && !address.internal
        );
        if (external) {
            return external.address;
        }
    }
    return "127.0.0.1";
}

/** Arrow's plugin for one inventory source, e.g. "EUROPE". */
export function arrowPlugin(supplier: SupplierId): SupplierPlugin {
    const source = SUPPLIERS[supplier].source!;
    return {
        id: supplier,
        batchSize: DEFAULT_BATCH,
        batchSizeFor: config => Number(config.partsPerRequest) || DEFAULT_BATCH,
        requestsPerBatch: 1,
        requiredSecrets: ["login", "apiKey"],
        testPartNumber: "BAV99",

        async lookup(partNumbers, context) {
            const login = context.secrets.login ?? "";
            const apikey = context.secrets.apiKey ?? "";
            // The request is in the URL, encoded.
            context.addSecret(encodeURIComponent(apikey));
            context.addSecret(encodeURIComponent(login));
            const query = new URLSearchParams({
                req: JSON.stringify({
                    request: {
                        login,
                        apikey,
                        remoteIp: localAddress(),
                        useExact: true,
                        parts: partNumbers.map(pn => ({ partNum: pn.trim() }))
                    }
                }),
                utm_currency: String(context.config.currency ?? "EUR")
            });
            const response = await context.http.request({
                method: "GET",
                url: `${context.baseUrl(DEFAULT_URL)}/itemservice/v4/en/search/list?${query.toString()}`,
                headers: { Accept: "application/json" }
            });
            return parseArrowResponse(
                partNumbers,
                source,
                response.status,
                response.json()
            );
        }
    };
}

/** A part number without punctuation and leading zeros, as other
 *  suppliers' manufacturer part numbers are compared (matching.ts). */
function looseKey(partNumber: string): string {
    return partNumberKey(partNumber)
        .replace(/[^0-9A-Z]/g, "")
        .replace(/^0+/, "");
}

/** Exported for tests. */
export function parseArrowResponse(
    partNumbers: readonly string[],
    source: string,
    status: number,
    body: unknown
): Map<string, LookupOutcome> {
    if (status === 401 || status === 403) {
        throw new AuthError(`Arrow refused the request (HTTP ${status}).`);
    }
    if (status === 429) {
        throw new ThrottledError("Too many requests.", 60_000);
    }
    const parsed = responseSchema.safeParse(body);
    if (status !== 200 || !parsed.success) {
        throw new SupplierError(
            `Unexpected answer from Arrow (HTTP ${status}).`
        );
    }
    const result = parsed.data.itemserviceresult;
    // Errors come with HTTP 200 too.
    const answer = result.transactionArea?.[0]?.response;
    if (answer && String(answer.success) === "false") {
        const message = answer.returnMsg || `error ${answer.returnCode}`;
        if (
            /login|api ?key|credential|authori[sz]|not allowed|access/i.test(
                message
            )
        ) {
            throw new AuthError(
                `Arrow rejected the login or API key (${message}). Check them in Settings.`
            );
        }
        if (/limit|too many|throttl/i.test(message)) {
            throw new ThrottledError(`Arrow: ${message}`, 60_000);
        }
        throw new SupplierError(`Arrow: ${message}`);
    }
    const answers = (result.data ?? []).flatMap(data => [
        ...(data.PartList ? [{ requested: null, parts: data.PartList }] : []),
        ...(data.resultList ?? []).map(entry => ({
            requested: entry.requestedPartNum ?? null,
            parts: entry.PartList ?? []
        }))
    ]);
    const parts = answers.flatMap(answer => answer.parts);
    return new Map(
        partNumbers.map(pn => {
            // Arrow names the part number each answer is for, written its
            // way: "ERZE14A431" for ERZ-E14A431.
            const wanted = looseKey(pn);
            const answered = answers
                .filter(a => a.requested && looseKey(a.requested) === wanted)
                .flatMap(a => a.parts);
            return [
                partNumberKey(pn),
                answered.length > 0
                    ? offerOutcome(answered, source)
                    : outcomeFor(pn, parts, source)
            ];
        })
    );
}

/** The sources of a part named `source` (ACNA is also called NAC). */
function sourcesOf(part: ArrowPart, source: string): ArrowSource[] {
    const all = [
        ...(part.InvOrg?.webSites ?? []).flatMap(site => site.sources ?? []),
        ...(part.InvOrg?.sources ?? [])
    ];
    const names = source === "ACNA" ? ["ACNA", "NAC"] : [source];
    return all.filter(s => names.includes((s.sourceCd ?? "").toUpperCase()));
}

function stockOf(sourcePart: ArrowSourcePart): number {
    return (sourcePart.Availability ?? []).reduce(
        (sum, availability) => sum + (toInteger(availability.fohQty) ?? 0),
        0
    );
}

/**
 * The outcome for one part number: the parts Arrow lists under it, in this
 * source. Arrow's part numbers are manufacturer part numbers, so several
 * items can't be told apart by the cell; the one with the most stock is
 * taken, and the others are named in its notes.
 */
function outcomeFor(
    partNumber: string,
    parts: readonly ArrowPart[],
    source: string
): LookupOutcome {
    let matching = parts.filter(
        part => partNumberKey(part.partNum ?? "") === partNumberKey(partNumber)
    );
    if (matching.length === 0) {
        const wanted = looseKey(partNumber);
        matching = parts.filter(
            part => wanted !== "" && looseKey(part.partNum ?? "") === wanted
        );
    }
    return offerOutcome(matching, source);
}

/** The best offer of these parts in this source: one with prices, then
 *  the most stock. */
function offerOutcome(
    matching: readonly ArrowPart[],
    source: string
): LookupOutcome {
    const offers = matching.flatMap(part =>
        sourcesOf(part, source).flatMap(s =>
            (s.sourceParts ?? []).map(sourcePart => ({
                part,
                offer: toOffer(part, s, sourcePart)
            }))
        )
    );
    if (offers.length === 0) {
        return { status: "notFound" };
    }
    const priced = (offer: SupplierOffer) =>
        offer.priceBreaks.length > 0 ? 1 : 0;
    offers.sort(
        (a, b) =>
            priced(b.offer) - priced(a.offer) ||
            b.offer.stockQty - a.offer.stockQty
    );
    const [best, ...others] = offers;
    const notes = [
        ...(best!.offer.notes ?? []),
        ...others.map(
            ({ part, offer }) =>
                `Also: ${[part.manufacturer?.mfrName, offer.packaging]
                    .filter(Boolean)
                    .join(
                        ", "
                    )}, ${offer.stockQty.toLocaleString("en")} in stock, MOQ ${offer.moq}`
        )
    ];
    return {
        status: "found",
        offer: { ...best!.offer, notes: notes.length > 0 ? notes : undefined },
        matchedBy: "supplierPartNumber"
    };
}

function toOffer(
    part: ArrowPart,
    source: ArrowSource,
    sourcePart: ArrowSourcePart
): SupplierOffer {
    const priceBreaks = sortBreaks(
        (sourcePart.Prices?.resaleList ?? []).flatMap((price: ArrowPrice) => {
            const qty = toInteger(price.minQty);
            const unitPrice = Number(price.price ?? price.displayPrice);
            return qty && Number.isFinite(unitPrice)
                ? [{ qty, unitPrice }]
                : [];
        })
    );
    const packSize = toInteger(sourcePart.packSize) ?? 1;
    const rohs = part.EnvData?.compliance?.find(
        item => (item.displayLabel ?? "").toLowerCase() === "eurohs"
    )?.displayValue;
    const detail =
        sourcePart.resources?.find(r => r.type === "detail")?.uri ??
        part.resources?.find(r => r.type === "cloud_part_detail")?.uri;
    const ships = [
        sourcePart.shipsFrom && `Ships from ${sourcePart.shipsFrom}`,
        sourcePart.shipsIn?.trim()
    ].filter(Boolean);
    // Some packagings have no prices, only e.g. "Call For Quote".
    const message = sourcePart.Availability?.[0]?.availabilityMessage?.trim();
    const notes = [
        ...(priceBreaks.length === 0 && message
            ? [`No price: ${message}`]
            : []),
        ...(ships.length > 0 ? [ships.join(", ")] : []),
        ...(sourcePart.isNcnr ? ["Non-cancellable, non-returnable"] : [])
    ];
    return {
        supplierPartNumber: part.partNum ?? "",
        manufacturer: part.manufacturer?.mfrName ?? "",
        manufacturerPartNumber: part.partNum ?? "",
        description: part.desc ?? "",
        packaging:
            sourcePart.containerType ||
            (packSize > 1 ? `Pack of ${packSize}` : undefined),
        stockQty: stockOf(sourcePart),
        moq: toInteger(sourcePart.minimumOrderQuantity) || 1,
        orderMultiple: Math.max(1, packSize),
        priceBreaks,
        // Resale prices; Arrow keeps customer prices for later.
        priceKind: "list",
        currency: normalizeCurrency(source.currency),
        lifecycle: arrowLifecycle(part.status),
        lifecycleRaw: part.status || null,
        rohs: rohs ? `EU RoHS: ${rohs}` : null,
        productUrl: detail || undefined,
        notes: notes.length > 0 ? notes : undefined
    };
}
