// Texts for calculated values, shared by the table and exports so both
// say the same thing.

import { LIFECYCLE_LABELS } from "./lifecycle";
import type { SupplierOffer } from "./model";
import type { Numbers } from "./numbers";
import type { SupplierLine } from "./pricing";

/** Notes that start with this tell of other packagings of the same product
 *  with stock, e.g. a box when cut tape is out of stock. */
export const OTHER_PACKAGING = "Other packaging: ";

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
