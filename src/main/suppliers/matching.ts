import {
    partNumberKey,
    type LookupOutcome,
    type SupplierOffer
} from "../../shared/model";

/**
 * Picks the outcome for one requested part number among the offers a
 * supplier returned ("BOM checker architecture.md", 6.2): an exact supplier
 * part number wins; otherwise the cell may hold a manufacturer part number,
 * which is accepted when only one offer has it, as written or else in
 * another form (`looseKey`). With `askWhenUnsure`, offers the supplier
 * returned without any match are offered for the user to choose from,
 * instead of "not found".
 */
export function matchOutcome(
    partNumber: string,
    offers: readonly SupplierOffer[],
    { askWhenUnsure = false } = {}
): LookupOutcome {
    const key = partNumberKey(partNumber);
    const exact = offers.find(
        offer => partNumberKey(offer.supplierPartNumber) === key
    );
    if (exact) {
        return {
            status: "found",
            offer: exact,
            matchedBy: "supplierPartNumber"
        };
    }
    for (const keyOf of [partNumberKey, looseKey]) {
        const wanted = keyOf(partNumber);
        const byManufacturer =
            wanted === ""
                ? []
                : offers.filter(
                      offer => keyOf(offer.manufacturerPartNumber) === wanted
                  );
        if (byManufacturer.length === 1) {
            return {
                status: "found",
                offer: byManufacturer[0]!,
                matchedBy: "mpn"
            };
        }
        if (byManufacturer.length > 1) {
            return { status: "ambiguous", candidates: byManufacturer };
        }
    }
    if (askWhenUnsure && offers.length > 0) {
        return { status: "ambiguous", candidates: [...offers] };
    }
    return { status: "notFound" };
}

/**
 * A manufacturer part number without punctuation and leading zeros, since
 * some are written in more than one form: Molex 22-01-3037 is 0022013037
 * at DigiKey.
 */
function looseKey(partNumber: string): string {
    return partNumberKey(partNumber)
        .replace(/[^0-9A-Z]/g, "")
        .replace(/^0+/, "");
}

/** Numbers that some APIs send as strings ("1027", "1"). */
export function toInteger(
    value: string | number | null | undefined
): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? Math.trunc(value) : null;
    }
    const digits = value?.replace(/[^\d]/g, "");
    return digits ? Number(digits) : null;
}

/** ISO 4217 codes; some suppliers use others (Mouser: "RMB"). */
export function normalizeCurrency(code: string | null | undefined): string {
    const upper = (code ?? "").trim().toUpperCase();
    return upper === "RMB" ? "CNY" : upper;
}

export function sortBreaks<T extends { qty: number }>(breaks: T[]): T[] {
    return [...breaks].sort((a, b) => a.qty - b.qty);
}
