// Texts for calculated values, shared by the table and exports so both
// say the same thing.

import { LIFECYCLE_LABELS } from "./lifecycle";
import type { SupplierOffer } from "./model";
import type { SupplierLine } from "./pricing";

const QUANTITY = new Intl.NumberFormat("en");

/** Notes that start with this tell of other packagings of the same product
 *  with stock, e.g. a box when cut tape is out of stock. */
export const OTHER_PACKAGING = "Other packaging: ";

/** "Other packaging: 495-4874-3-ND (Tape & Box (TB)): 1,930 in stock,
 *  MOQ 2,000." */
export function otherPackagingNote(offer: {
    supplierPartNumber: string;
    packaging?: string;
    stockQty: number;
    moq: number;
}): string {
    return (
        `${OTHER_PACKAGING}${offer.supplierPartNumber}` +
        (offer.packaging ? ` (${offer.packaging})` : "") +
        `: ${QUANTITY.format(offer.stockQty)} in stock` +
        (offer.moq > 1 ? `, MOQ ${QUANTITY.format(offer.moq)}.` : ".")
    );
}

/** The Availability text, including lookups that found nothing usable. */
export function availabilityText(line: SupplierLine | null): string {
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
            return `Partial: ${QUANTITY.format(availability.stock)}`;
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
