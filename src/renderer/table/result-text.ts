import { formatDateTime } from "../../shared/collection";
import { LIFECYCLE_LABELS } from "../../shared/lifecycle";
import type { LookupResult, SupplierOffer } from "../../shared/model";

const PRICE_KINDS: Record<SupplierOffer["priceKind"], string> = {
    account: "your account's prices",
    list: "list prices",
    unknown: "price type not stated by the supplier"
};

function formatPrice(value: number, currency: string): string {
    return `${value.toLocaleString("en", { maximumFractionDigits: 5 })} ${currency}`;
}

function describeOffer(offer: SupplierOffer): string[] {
    const breaks = offer.priceBreaks
        .slice(0, 4)
        .map(
            b =>
                `${b.qty.toLocaleString("en")}+: ${formatPrice(b.unitPrice, offer.currency)}`
        );
    return [
        `${offer.supplierPartNumber}${offer.packaging ? ` (${offer.packaging})` : ""}`,
        `${offer.manufacturer} ${offer.manufacturerPartNumber}`.trim(),
        offer.description,
        `Stock: ${offer.stockQty.toLocaleString("en")}`,
        `MOQ: ${offer.moq.toLocaleString("en")}` +
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
    result: LookupResult
): string {
    const checked = `Checked ${formatDateTime(result.fetchedAt)}`;
    switch (result.status) {
        case "found":
            return [
                ...describeOffer(result.offer),
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
                "Enter the exact part number to choose one.",
                checked
            ].join("\n");
        case "error":
            return `Couldn't check: ${result.message}\n${checked}`;
    }
}
