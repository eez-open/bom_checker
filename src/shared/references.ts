// Reference designators in BOM rows, e.g. "C1,C2,C10".

/** "C1, C2,C3 " → ["C1", "C2", "C3"]. */
export function splitReferences(text: string): string[] {
    return text.split(/[,\s]+/).filter(Boolean);
}

/** Natural order: R2 before R10, C9 before R1. */
export function compareReferences(a: string, b: string): number {
    return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/** References in natural order, as KiCad lists them: "C1,C2,C10". */
export function joinReferences(references: Iterable<string>): string {
    return [...references].sort(compareReferences).join(",");
}

/** A BOM row as far as its references go. */
export interface ReferenceRow {
    id: string;
    reference: string;
    qty: number;
}

/**
 * Rows with a reference that another row has too, or that they list twice
 * (#58): each part is in one row only. By row id, what's wrong, e.g.
 * "C5 is also in row 12." References are compared ignoring case; rows are
 * numbered from 1, as in the Row column.
 */
export function duplicateReferences(
    rows: readonly ReferenceRow[]
): Map<string, string> {
    const rowsOf = new Map<string, number[]>();
    rows.forEach((row, index) => {
        for (const reference of splitReferences(row.reference)) {
            const key = reference.toUpperCase();
            rowsOf.set(key, [...(rowsOf.get(key) ?? []), index]);
        }
    });
    const problems = new Map<string, string>();
    rows.forEach((row, index) => {
        const messages: string[] = [];
        const seen = new Set<string>();
        for (const reference of splitReferences(row.reference)) {
            const key = reference.toUpperCase();
            const indexes = rowsOf.get(key)!;
            if (seen.has(key) || indexes.length < 2) {
                continue;
            }
            seen.add(key);
            const others = [
                ...new Set(indexes.filter(other => other !== index))
            ].map(other => other + 1);
            messages.push(
                others.length === 0
                    ? `${reference} is listed twice`
                    : `${reference} is also in row${others.length === 1 ? "" : "s"} ${others.join(", ")}`
            );
        }
        if (messages.length > 0) {
            problems.set(row.id, `${messages.join("; ")}.`);
        }
    });
    return problems;
}

/**
 * What's wrong when a row's Qty isn't its number of references (#58), or
 * null. Rows without references, and decimal quantities (amounts such as
 * metres of tape), aren't compared.
 */
export function quantityMismatch(row: ReferenceRow): string | null {
    const count = splitReferences(row.reference).length;
    if (count === 0 || !Number.isInteger(row.qty) || row.qty === count) {
        return null;
    }
    return `${count} reference${count === 1 ? "" : "s"}, but Qty is ${row.qty}.`;
}
