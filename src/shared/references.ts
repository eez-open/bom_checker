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
