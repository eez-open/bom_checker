// Rules for supplier part-number cells, as defined in the project scope.

/** Imported and typed values are trimmed on both sides. */
export function normalizeCell(raw: string | null | undefined): string {
    return raw?.trim() ?? "";
}

/** A supplier part number is not defined when the cell is empty or "-". */
export function isPartNumberDefined(raw: string | null | undefined): boolean {
    const value = normalizeCell(raw);
    return value !== "" && value !== "-";
}

/**
 * True when a cell lists alternatives, e.g. "EPP-150-48 or LOP-200-48".
 * Such cells are flagged for the user to fix and skipped during collection.
 */
export function hasAlternatives(raw: string | null | undefined): boolean {
    return /\s+or\s+/i.test(normalizeCell(raw));
}

/**
 * Generic values of passives: 100n, 4u7, 10k, 0R010, 2.2uF, 100nF/50V,
 * 10k 1%. SI prefixes are case-sensitive, so 1N4148 or 2N7002 aren't taken
 * for "1n".
 */
const COMPONENT_VALUE =
    /^\d+([.,]\d+)?\s*([pnuµmkKMGR]\d*)?\s*(F|H|Ω|ohms?)?([\s/,]+\d+([.,]\d+)?\s*(%|V|W|A|mA))*$/;

/**
 * The Value, when it may be a manufacturer part number to look up
 * (TPS54331DDA, 1N4007, ESP32-S3-WROOM-1); null for generic values (100n,
 * 10k), names of KiCad symbols (Conn_01x04, LED) and text with spaces.
 */
export function valueAsPartNumber(
    raw: string | null | undefined
): string | null {
    const value = normalizeCell(raw);
    const looksLikePartNumber =
        value.length >= 3 &&
        value.length <= 40 &&
        !/[\s_]/.test(value) &&
        /[A-Za-z]/.test(value) &&
        /\d/.test(value) &&
        !COMPONENT_VALUE.test(value);
    return looksLikePartNumber ? value : null;
}
