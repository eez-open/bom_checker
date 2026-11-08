// Texts for calculated values, shared by the table and exports so both
// say the same thing.

import { LIFECYCLE_LABELS } from "./lifecycle";
import type { SupplierOffer } from "./model";
import type { Numbers } from "./numbers";
import type { BestChoice, SupplierLine } from "./pricing";

/** Notes that start with this tell of other packagings of the same product
 *  with stock, e.g. a box when cut tape is out of stock. */
export const OTHER_PACKAGING = "Other packaging: ";

/** Rows whose best price is for only what one supplier has in stock
 *  (#74), and rows it leaves out, since no supplier can deliver any of
 *  them (#49): a sentence each, for the Best price header and the cost
 *  charts; none when the best price covers every row. */
export function stockWarnings({
    partial,
    uncovered
}: {
    partial: number;
    uncovered: number;
}): string[] {
    const warnings: string[] = [];
    if (partial > 0) {
        warnings.push(
            partial === 1
                ? "1 row has no supplier with enough stock, so its best price is for the part in stock."
                : `${partial} rows have no supplier with enough stock, so their best prices are for the part in stock.`
        );
    }
    if (uncovered > 0) {
        warnings.push(
            uncovered === 1
                ? "1 row has no supplier that can deliver any of it, so the best price leaves it out."
                : `${uncovered} rows have no supplier that can deliver any of them, so the best price leaves them out.`
        );
    }
    return warnings;
}

/** The Best price supplier: its name, and when it has only part of the
 *  order quantity (#74), what it has, e.g. "DigiKey (Partial: 44)". */
export function bestSupplierText(
    name: string,
    choice: BestChoice,
    numbers: Numbers
): string {
    return choice.partial
        ? `${name} (${availabilityText(choice.line, numbers)})`
        : name;
}

/** "Other packaging: 495-4874-3-ND (Tape & Box (TB)): 1930 in stock,
 *  MOQ 2000." Kept with the collected data, so without grouping, which
 *  would read as decimals with a decimal comma (#37). */
export function otherPackagingNote(offer: {
    supplierPartNumber: string;
    packaging?: string;
    stockQty: number;
    moq: number;
}): string {
    return (
        `${OTHER_PACKAGING}${offer.supplierPartNumber}` +
        (offer.packaging ? ` (${offer.packaging})` : "") +
        `: ${offer.stockQty} in stock` +
        (offer.moq > 1 ? `, MOQ ${offer.moq}.` : ".")
    );
}

/** The Availability text, including lookups that found nothing usable. */
export function availabilityText(
    line: SupplierLine | null,
    numbers: Numbers
): string {
    if (!line) {
        return "";
    }
    switch (line.result.status) {
        case "notFound":
            return "Not found";
        case "ambiguous":
            return "Choose an item";
        case "error":
            return "Couldn't check";
        case "found":
            break;
    }
    const availability = line.availability!;
    switch (availability.kind) {
        case "in-stock":
            return "In stock";
        case "partial":
            return `Partial: ${numbers.quantity(availability.stock)}`;
        case "out-of-stock":
            return "Out of stock";
        case "not-orderable":
            return "Not orderable";
    }
}

/** The lifecycle label, or the supplier's own text if it isn't known. */
export function statusText(offer: SupplierOffer | null | undefined): string {
    if (!offer) {
        return "";
    }
    return offer.lifecycle
        ? LIFECYCLE_LABELS[offer.lifecycle]
        : (offer.lifecycleRaw ?? "");
}
