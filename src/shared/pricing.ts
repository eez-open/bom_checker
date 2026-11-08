// Order quantity, price, availability and best supplier ("BOM checker
// architecture.md", 5.3). Calculated from the BOM and the collected data
// whenever they are shown, so changing Qty updates everything at once.

import {
    partNumberKey,
    type BomRow,
    type CollectedData,
    type LookupResult,
    type ManualOffer,
    type ManualSupplier,
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
    // Decimal quantities (0.004 m × 1250 = 5.000000000000001) mustn't add
    // a whole package.
    const packages = Number((Math.max(qty, moq) / step).toFixed(9));
    return Math.ceil(packages) * step;
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

/** Null when the row has no usable part number or nothing was collected.
 *  The row's Qty is multiplied by `buildQuantity`. */
export function supplierLine(
    row: BomRow,
    supplier: SupplierId,
    collected: CollectedData,
    buildQuantity: number
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
    return lineFor(result, row.qty * buildQuantity);
}

/** Order quantity, price, total and availability of a found offer. */
function lineFor(
    result: Extract<LookupResult, { status: "found" }>,
    quantity: number
): SupplierLine {
    const { offer } = result;
    const orderQty = orderQuantity(quantity, offer.moq, offer.orderMultiple);
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

/** A supplier without an API's price breaks (#51): the unit price from 1,
 *  then the lower prices for larger quantities. */
export function manualPriceBreaks(
    offer: ManualOffer | undefined
): PriceBreak[] {
    return offer?.unitPrice === undefined
        ? []
        : [
              { qty: 1, unitPrice: offer.unitPrice },
              ...(offer.priceBreaks ?? [])
          ];
}

/**
 * The line of a supplier without an API (#20), from what was typed: the
 * unit price in EUR with its price breaks (#51), the MOQ and the stock,
 * where no stock means always available (e.g. made to order). A one-time
 * item (#53) isn't multiplied by the build quantity. Null when nothing was
 * typed.
 */
export function manualLine(
    row: BomRow,
    supplier: ManualSupplier,
    buildQuantity: number
): SupplierLine | null {
    const entry = row.manual?.[supplier.id];
    if (!entry || (entry.unitPrice === undefined && !entry.partNumber)) {
        return null;
    }
    const offer: SupplierOffer = {
        supplierPartNumber: entry.partNumber ?? "",
        manufacturer: "",
        manufacturerPartNumber: "",
        description: "",
        stockQty: entry.stock ?? Number.POSITIVE_INFINITY,
        moq: entry.moq ?? 1,
        orderMultiple: 1,
        priceBreaks: manualPriceBreaks(entry),
        priceKind: "unknown",
        currency: BASE_CURRENCY,
        lifecycle: null,
        lifecycleRaw: null,
        rohs: null
    };
    return lineFor(
        {
            status: "found",
            offer,
            matchedBy: "supplierPartNumber",
            runId: "",
            fetchedAt: ""
        },
        entry.oneTime ? row.qty : row.qty * buildQuantity
    );
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

/**
 * A supplier's line for only what it has in stock (#74), when that's less
 * than the order quantity: the stock rounded down to the order multiple,
 * at the price break for that quantity. Null when that's nothing or below
 * the MOQ, so nothing can be ordered.
 */
function inStockLine(line: SupplierLine): SupplierLine | null {
    const { offer } = line;
    if (!offer || line.availability?.kind !== "partial") {
        return null;
    }
    const step = Math.max(1, offer.orderMultiple);
    const orderQty = Math.floor(offer.stockQty / step) * step;
    const price = priceAt(offer.priceBreaks, orderQty);
    if (orderQty <= 0 || orderQty < offer.moq || !price) {
        return null;
    }
    return {
        ...line,
        orderQty,
        unitPrice: price.unitPrice,
        belowFirstBreak: price.belowFirstBreak,
        total: line.inBaseCurrency ? price.unitPrice * orderQty : null
    };
}

export interface BestChoice {
    /** A `SupplierId`, or the id of a supplier without an API. */
    supplier: string;
    line: SupplierLine & {
        offer: SupplierOffer;
        orderQty: number;
        total: number;
    };
    /** No supplier has the whole order quantity in stock (#74): this one
     *  has the most, and `line` is for only what it has. */
    partial: boolean;
}

/**
 * The cheapest supplier by total price that has the whole order quantity
 * in stock and prices in the base currency. Equal totals go to the
 * supplier earlier in `preference`; suppliers without an API come after
 * those with one.
 *
 * When none has the whole quantity, the one with the most in stock, for
 * what it has (`partial`, #74); equal quantities go to the lower unit
 * price, then as above. Null when no supplier can sell any of it at a
 * price in the base currency.
 */
export function bestSupplier(
    row: BomRow,
    collected: CollectedData,
    suppliers: readonly SupplierId[],
    preference: readonly SupplierId[],
    buildQuantity: number,
    manual: readonly ManualSupplier[] = []
): BestChoice | null {
    const candidates: BestChoice[] = [];
    const partial: BestChoice[] = [];
    const usable = (line: SupplierLine | null): line is BestChoice["line"] =>
        Boolean(line?.offer && line.orderQty && line.total !== null);
    const consider = (supplier: string, line: SupplierLine | null) => {
        if (!line) {
            return;
        }
        if (line.availability?.kind === "in-stock") {
            if (usable(line)) {
                candidates.push({ supplier, line, partial: false });
            }
            return;
        }
        const inStock = inStockLine(line);
        if (usable(inStock)) {
            partial.push({ supplier, line: inStock, partial: true });
        }
    };
    for (const supplier of suppliers) {
        consider(
            supplier,
            supplierLine(row, supplier, collected, buildQuantity)
        );
    }
    for (const supplier of manual) {
        consider(supplier.id, manualLine(row, supplier, buildQuantity));
    }
    const rank = (supplier: string) => {
        const index = preference.indexOf(supplier as SupplierId);
        return index >= 0
            ? index
            : preference.length + manual.findIndex(m => m.id === supplier);
    };
    candidates.sort(
        (a, b) =>
            a.line.total - b.line.total || rank(a.supplier) - rank(b.supplier)
    );
    if (candidates.length > 0) {
        return candidates[0]!;
    }
    partial.sort(
        (a, b) =>
            b.line.orderQty - a.line.orderQty ||
            a.line.total - b.line.total ||
            rank(a.supplier) - rank(b.supplier)
    );
    return partial[0] ?? null;
}

/**
 * Whether any supplier has some of the row in stock, also one that can't
 * sell it at a price in the base currency. Tells a row without a best
 * price that has none in stock anywhere from one whose suppliers can't
 * sell what they have (#74), e.g. less than their MOQ, or an item is
 * still to be chosen from several. A supplier without an API with no stock
 * typed counts as having it.
 */
export function anyInStock(row: BomRow, project: Project): boolean {
    const inStock = (line: SupplierLine | null) =>
        (line?.offer?.stockQty ?? 0) > 0 ||
        (line?.result.status === "ambiguous" &&
            line.result.candidates.some(offer => offer.stockQty > 0));
    return (
        project.suppliers.some(s =>
            inStock(
                supplierLine(row, s, project.collected, project.buildQuantity)
            )
        ) ||
        project.manualSuppliers.some(s =>
            inStock(manualLine(row, s, project.buildQuantity))
        )
    );
}

export interface BomTotals {
    /** Sum of the best totals. */
    total: number;
    /** Rows with a best supplier, also those in `partial`. */
    covered: number;
    /** Rows that no supplier has enough stock for, whose best price is
     *  for only what one has (#74). */
    partial: number;
    /** Rows with supplier data but no supplier that can deliver any. */
    uncovered: number;
}

export function bomTotals(
    project: Project,
    preference: readonly SupplierId[]
): BomTotals {
    const totals: BomTotals = {
        total: 0,
        covered: 0,
        partial: 0,
        uncovered: 0
    };
    for (const row of project.rows) {
        const best = bestSupplier(
            row,
            project.collected,
            project.suppliers,
            preference,
            project.buildQuantity,
            project.manualSuppliers
        );
        if (best) {
            totals.total += best.line.total;
            totals.covered++;
            totals.partial += best.partial ? 1 : 0;
        } else if (hasSupplierData(row, project)) {
            totals.uncovered++;
        }
    }
    return totals;
}

/** Whether any supplier has data for the row: collected, or typed in. */
export function hasSupplierData(row: BomRow, project: Project): boolean {
    return (
        project.suppliers.some(s =>
            supplierLine(row, s, project.collected, project.buildQuantity)
        ) ||
        project.manualSuppliers.some(s =>
            manualLine(row, s, project.buildQuantity)
        )
    );
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
        const total = supplierLine(
            row,
            supplier,
            project.collected,
            project.buildQuantity
        )?.total;
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
            const line = supplierLine(
                row,
                supplier,
                project.collected,
                project.buildQuantity
            );
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

/**
 * Whether a row belongs in a rows filter: "best:<supplier>" when that
 * supplier has its best price, also for only part of the quantity;
 * "partial" when its best price is for only part of it (#74); "none" when
 * it has supplier data but no best price; anything else for all rows.
 */
export function matchesRowView(
    row: BomRow,
    project: Project,
    preference: readonly SupplierId[],
    view: string
): boolean {
    if (view === "all") {
        return true;
    }
    const best = bestSupplier(
        row,
        project.collected,
        project.suppliers,
        preference,
        project.buildQuantity,
        project.manualSuppliers
    );
    if (view === "none") {
        return !best && hasSupplierData(row, project);
    }
    if (view === "partial") {
        return best?.partial === true;
    }
    return best !== null && view === `best:${best.supplier}`;
}

/** The Total price column of a supplier without an API, added up. */
export function manualTotal(
    project: Project,
    supplier: ManualSupplier
): ColumnTotal {
    const sum: ColumnTotal = { total: 0, priced: 0 };
    for (const row of project.rows) {
        const total = manualLine(row, supplier, project.buildQuantity)?.total;
        if (total != null) {
            sum.total += total;
            sum.priced++;
        }
    }
    return sum;
}
