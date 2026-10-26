// Rules for supplier part-number cells, as defined in the project scope.

/** Imported and typed values are trimmed on both sides. */
export function normalizeCell(raw: string | undefined): string {
    return raw?.trim() ?? "";
}

/** A supplier part number is not defined when the cell is empty or "-". */
export function isPartNumberDefined(raw: string | undefined): boolean {
    const value = normalizeCell(raw);
    return value !== "" && value !== "-";
}

/**
 * True when a cell lists alternatives, e.g. "EPP-150-48 or LOP-200-48".
 * Such cells are flagged for the user to fix and skipped during collection.
 */
export function hasAlternatives(raw: string | undefined): boolean {
    return /\s+or\s+/i.test(normalizeCell(raw));
}
