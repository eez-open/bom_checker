import { formatDateTime } from "../../shared/collection";
import { LIFECYCLE_LABELS } from "../../shared/lifecycle";
import type { LookupResult, SupplierOffer } from "../../shared/model";
import type { Numbers } from "../../shared/numbers";

const PRICE_KINDS: Record<SupplierOffer["priceKind"], string> = {
    account: "your account's prices",
    list: "list prices",
    unknown: "price type not stated by the supplier"
};

function describeOffer(offer: SupplierOffer, numbers: Numbers): string[] {
    const breaks = offer.priceBreaks
        .slice(0, 4)
        .map(
            b =>
                `${numbers.quantity(b.qty)}+: ${numbers.price(b.unitPrice)} ${offer.currency}`
        );
    return [
        `${offer.supplierPartNumber}${offer.packaging ? ` (${offer.packaging})` : ""}`,
        `${offer.manufacturer} ${offer.manufacturerPartNumber}`.trim(),
        offer.description,
        `Stock: ${numbers.quantity(offer.stockQty)}`,
        `MOQ: ${numbers.quantity(offer.moq)}` +
            (offer.orderMultiple > 1
                ? `, in multiples of ${offer.orderMultiple}`
                : ""),
        breaks.length > 0
            ? `Prices (${PRICE_KINDS[offer.priceKind]}): ${breaks.join(" · ")}`
            : "No prices",
        `Status: ${offer.lifecycle ? LIFECYCLE_LABELS[offer.lifecycle] : (offer.lifecycleRaw ?? "not reported")}` +
            (offer.lifecycle &&
            offer.lifecycleRaw &&
            offer.lifecycleRaw !== LIFECYCLE_LABELS[offer.lifecycle]
                ? ` (${offer.lifecycleRaw})`
                : ""),
        `RoHS: ${offer.rohs ?? "not reported"}`,
        ...(offer.notes ?? [])
    ].filter(line => line !== "");
}

/** Tooltip text for a part-number cell with collected data. */
export function describeResult(
    supplierName: string,
    result: LookupResult,
    numbers: Numbers
): string {
    const checked = `Checked ${formatDateTime(result.fetchedAt)}`;
    switch (result.status) {
        case "found":
            return [
                ...describeOffer(result.offer, numbers),
                ...(result.matchedBy === "mpn"
                    ? ["Found by manufacturer part number."]
                    : []),
                checked
            ].join("\n");
        case "notFound":
            return `${supplierName} doesn't know this part number.\n${checked}`;
        case "ambiguous":
            return [
                `Several ${supplierName} items match:`,
                ...result.candidates.map(
                    c =>
                        `• ${c.supplierPartNumber}${c.packaging ? ` (${c.packaging})` : ""}, ${c.manufacturer}`
                ),
                "Choose one in the Availability column, or click ? to compare them.",
                checked
            ].join("\n");
        case "error":
            return `Couldn't check: ${result.message}\n${checked}`;
    }
}
