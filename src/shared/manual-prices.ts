// Price breaks of suppliers without an API (#51): the unit price from 1
// piece on, and up to three lower unit prices for larger quantities, e.g.
// 1.10 from 1, 1.00 from 25, 0.80 from 100 and 0.65 from 300. They're
// typed in the Unit price cell's editor.

import { MAX_MANUAL_PRICE_BREAKS, type PriceBreak } from "./model";
import { parseDecimal } from "./numbers";

/** All price breaks: the one from 1, and the others. */
export const MAX_MANUAL_PRICES = 1 + MAX_MANUAL_PRICE_BREAKS;

/** A row of the editor, as typed. */
export interface PriceBreakText {
    qty: string;
    price: string;
}

/**
 * The price breaks typed in the editor's rows, the first of which is from
 * 1. Empty rows are skipped and the others sorted by quantity. An empty
 * list means no price.
 */
export function parsePriceBreaks(
    rows: readonly PriceBreakText[]
): { breaks: PriceBreak[] } | { error: string } {
    const breaks: PriceBreak[] = [];
    for (const [index, row] of rows.entries()) {
        const qtyText = index === 0 ? "1" : row.qty.trim();
        const priceText = row.price.trim();
        if (index > 0 && qtyText === "" && priceText === "") {
            continue;
        }
        if (index === 0 && priceText === "") {
            if (rows.slice(1).some(r => r.qty.trim() || r.price.trim())) {
                return { error: "Enter the unit price from 1 first." };
            }
            continue;
        }
        if (qtyText === "") {
            return { error: `Enter the quantity for the price ${priceText}.` };
        }
        const qty = index === 0 ? 1 : parseDecimal(qtyText);
        if (qty === undefined || (index > 0 && qty <= 1)) {
            return { error: `"${qtyText}" isn't a quantity above 1.` };
        }
        if (priceText === "") {
            return { error: `Enter the unit price from ${qtyText}.` };
        }
        const unitPrice = parseDecimal(priceText);
        if (unitPrice === undefined || unitPrice < 0) {
            return { error: `"${priceText}" isn't a price.` };
        }
        if (breaks.some(b => b.qty === qty)) {
            return { error: `There are two prices from ${qtyText}.` };
        }
        breaks.push({ qty, unitPrice });
    }
    return { breaks: breaks.sort((a, b) => a.qty - b.qty) };
}

/** Price breaks from the renderer, checked: the first from 1, then
 *  ascending quantities. Null if they aren't valid. */
export function validPriceBreaks(raw: unknown): PriceBreak[] | null {
    if (!Array.isArray(raw) || raw.length > MAX_MANUAL_PRICES) {
        return null;
    }
    const breaks: PriceBreak[] = [];
    for (const item of raw as unknown[]) {
        const { qty, unitPrice } = (item ?? {}) as Record<string, unknown>;
        const previous = breaks.at(-1);
        if (
            typeof qty !== "number" ||
            typeof unitPrice !== "number" ||
            !Number.isFinite(qty) ||
            !Number.isFinite(unitPrice) ||
            unitPrice < 0 ||
            (previous ? qty <= previous.qty : qty !== 1)
        ) {
            return null;
        }
        breaks.push({ qty, unitPrice });
    }
    return breaks;
}
