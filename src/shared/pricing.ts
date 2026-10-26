// Order quantity, price, availability and best supplier ("BOM checker
// architecture.md", 5.3). Calculated from the BOM and the collected data
// whenever they are shown, so changing Qty updates everything at once.

import {
    partNumberKey,
    type BomRow,
    type CollectedData,
    type LookupResult,
    type PriceBreak,
    type Project,
    type SupplierId,
    type SupplierOffer
} from "./model";
import { hasAlternatives, isPartNumberDefined } from "./part-number";

/** All totals and best-price comparisons are in this currency. */
export const BASE_CURRENCY = "EUR";

export type Availability =
    | { kind: "in-stock" }
    | { kind: "partial"; stock: number }
    | { kind: "out-of-stock" }
    | { kind: "not-orderable" };

/** The quantity to buy: the BOM quantity, at least the MOQ, rounded up to
 *  the order multiple. 0 when the BOM needs none. */
export function orderQuantity(
    qty: number,
    moq: number,
    multiple: number
): number {
    if (qty <= 0) {
        return 0;
    }
    const step = Math.max(1, multiple);
    return Math.ceil(Math.max(qty, moq) / step) * step;
}

/** The unit price of the largest break at or below `quantity`. Below the
 *  first break, its price is used and `belowFirstBreak` is set. */
export function priceAt(
    breaks: readonly PriceBreak[],
    quantity: number
): { unitPrice: number; belowFirstBreak: boolean } | null {
    const first = breaks[0];
    if (!first) {
        return null;
    }
    let chosen = first;
    for (const priceBreak of breaks) {
        if (priceBreak.qty <= quantity) {
            chosen = priceBreak;
        }
    }
    return {
        unitPrice: chosen.unitPrice,
        belowFirstBreak: quantity < first.qty
    };
}

/** Calculated values for one row and supplier. */
export interface SupplierLine {
    result: LookupResult;
    /** Set when the part was found. */
    offer: SupplierOffer | null;
    orderQty: number | null;
    /** In the offer's currency. */
    unitPrice: number | null;
    belowFirstBreak: boolean;
    inBaseCurrency: boolean;
    /** In the base currency; null if prices are missing or in another
     *  currency. */
    total: number | null;
    availability: Availability | null;
}

/** Null when the row has no usable part number or nothing was collected. */
export function supplierLine(
    row: BomRow,
    supplier: SupplierId,
    collected: CollectedData
): SupplierLine | null {
    const partNumber = row.partNumbers[supplier];
    if (!isPartNumberDefined(partNumber) || hasAlternatives(partNumber)) {
        return null;
    }
    const result = collected.results[supplier]?.[partNumberKey(partNumber!)];
    if (!result) {
        return null;
    }
    if (result.status !== "found") {
        return {
            result,
            offer: null,
            orderQty: null,
            unitPrice: null,
            belowFirstBreak: false,
            inBaseCurrency: true,
            total: null,
            availability: null
        };
    }
    const { offer } = result;
    const orderQty = orderQuantity(row.qty, offer.moq, offer.orderMultiple);
    const price = priceAt(offer.priceBreaks, orderQty);
    const inBaseCurrency = offer.currency === BASE_CURRENCY;
    return {
        result,
        offer,
        orderQty,
        unitPrice: price?.unitPrice ?? null,
        belowFirstBreak: price?.belowFirstBreak ?? false,
        inBaseCurrency,
        total: inBaseCurrency && price ? price.unitPrice * orderQty : null,
        availability: availabilityOf(offer, orderQty)
    };
}

function availabilityOf(offer: SupplierOffer, orderQty: number): Availability {
    if (offer.lifecycle === "not-orderable") {
        return { kind: "not-orderable" };
    }
    if (offer.stockQty >= orderQty) {
        return { kind: "in-stock" };
    }
    return offer.stockQty > 0
        ? { kind: "partial", stock: offer.stockQty }
        : { kind: "out-of-stock" };
}

export interface BestChoice {
    supplier: SupplierId;
    line: SupplierLine & {
        offer: SupplierOffer;
        orderQty: number;
        total: number;
    };
}

/**
 * The cheapest supplier by total price that has the whole order quantity
 * in stock and prices in the base currency. Equal totals go to the
 * supplier earlier in `preference`.
 */
export function bestSupplier(
    row: BomRow,
    collected: CollectedData,
    suppliers: readonly SupplierId[],
    preference: readonly SupplierId[]
): BestChoice | null {
    const candidates: BestChoice[] = [];
    for (const supplier of suppliers) {
        const line = supplierLine(row, supplier, collected);
        if (
            line?.offer &&
            line.orderQty &&
            line.total !== null &&
            line.availability?.kind === "in-stock"
        ) {
            candidates.push({ supplier, line: line as BestChoice["line"] });
        }
    }
    const rank = (supplier: SupplierId) => {
        const index = preference.indexOf(supplier);
        return index < 0 ? preference.length : index;
    };
    candidates.sort(
        (a, b) =>
            a.line.total - b.line.total || rank(a.supplier) - rank(b.supplier)
    );
    return candidates[0] ?? null;
}

export interface BomTotals {
    /** Sum of the best totals. */
    total: number;
    /** Rows with a best supplier. */
    covered: number;
    /** Rows with collected data but no supplier that can deliver. */
    uncovered: number;
}

export function bomTotals(
    project: Project,
    preference: readonly SupplierId[]
): BomTotals {
    const totals: BomTotals = { total: 0, covered: 0, uncovered: 0 };
    for (const row of project.rows) {
        const best = bestSupplier(
            row,
            project.collected,
            project.suppliers,
            preference
        );
        if (best) {
            totals.total += best.line.total;
            totals.covered++;
        } else if (
            project.suppliers.some(s => supplierLine(row, s, project.collected))
        ) {
            totals.uncovered++;
        }
    }
    return totals;
}

export interface ColumnTotal {
    /** Sum of the supplier's total prices. */
    total: number;
    /** Rows with a total price; the others have none (no part number, not
     *  found, no price, or a price in another currency). */
    priced: number;
}

export function supplierTotal(
    project: Project,
    supplier: SupplierId
): ColumnTotal {
    const sum: ColumnTotal = { total: 0, priced: 0 };
    for (const row of project.rows) {
        const total = supplierLine(row, supplier, project.collected)?.total;
        if (total != null) {
            sum.total += total;
            sum.priced++;
        }
    }
    return sum;
}

/** Suppliers whose collected prices (for this BOM) aren't in the base
 *  currency, with those currencies. */
export function foreignCurrencies(
    project: Project
): Partial<Record<SupplierId, string[]>> {
    const found: Partial<Record<SupplierId, Set<string>>> = {};
    for (const row of project.rows) {
        for (const supplier of project.suppliers) {
            const line = supplierLine(row, supplier, project.collected);
            if (line?.offer && !line.inBaseCurrency) {
                (found[supplier] ??= new Set()).add(
                    line.offer.currency || "unknown"
                );
            }
        }
    }
    return Object.fromEntries(
        Object.entries(found).map(([supplier, set]) => [supplier, [...set]])
    );
}
