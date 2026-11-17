// Ordering more than needed, up to a price break, where that costs less in
// total (#86): 10 resistors at 0.02 instead of 5 at 0.10. The rows it would
// pay for are offered, and the user confirms each (`BomRow.buyToBreak`);
// pricing.ts then raises their order quantities.

import type { BomRow, Project, SupplierId } from "./model";
import { bestSupplier } from "./pricing";

/** What a row is ordered as: at which supplier, how many, for how much. */
export interface BreakOrder {
    /** A `SupplierId`, or the id of a supplier without an API. */
    supplier: string;
    orderQty: number;
    unitPrice: number;
    /** In the base currency. */
    total: number;
}

export interface BreakOffer {
    rowId: string;
    /** The row's place in the BOM, from 1. */
    rowNumber: number;
    reference: string;
    value: string;
    /** The best price for the quantity needed. */
    needed: BreakOrder;
    /** The best price when more is ordered, up to a price break; maybe at
     *  another supplier. */
    atBreak: BreakOrder;
    /** `needed.total` − `atBreak.total`. */
    saving: number;
    /** The row is ordered up to price breaks already. */
    confirmed: boolean;
}

/** The rows that cost less when more is ordered, also those that are
 *  ordered so already, in the BOM's order. */
export function breakOffers(
    project: Project,
    preference: readonly SupplierId[]
): BreakOffer[] {
    return project.rows.flatMap((row, index) => {
        // What it costs without ordering more.
        const plain: BomRow = { ...row };
        delete plain.buyToBreak;
        const best = bestSupplier(
            plain,
            project.collected,
            project.suppliers,
            preference,
            project.buildQuantity,
            project.manualSuppliers
        );
        if (!best?.cheaper) {
            return [];
        }
        const { line, cheaper } = best;
        return [
            {
                rowId: row.id,
                rowNumber: index + 1,
                reference: row.reference,
                value: row.value,
                needed: {
                    supplier: best.supplier,
                    orderQty: line.orderQty,
                    unitPrice: line.unitPrice ?? line.total / line.orderQty,
                    total: line.total
                },
                atBreak: {
                    supplier: cheaper.supplier,
                    orderQty: cheaper.orderQty,
                    unitPrice: cheaper.unitPrice,
                    total: cheaper.total
                },
                saving: line.total - cheaper.total,
                confirmed: row.buyToBreak === true
            }
        ];
    });
}

/**
 * Sets which rows are ordered up to price breaks, by row id: true for
 * those that are, false for those that aren't any more. Returns the same
 * object when nothing changes.
 */
export function setBuyToBreak(
    project: Project,
    changes: ReadonlyMap<string, boolean>
): Project {
    let changed = false;
    const rows = project.rows.map(row => {
        const on = changes.get(row.id);
        if (on === undefined || on === (row.buyToBreak === true)) {
            return row;
        }
        changed = true;
        const next: BomRow = { ...row };
        if (on) {
            next.buyToBreak = true;
        } else {
            delete next.buyToBreak;
        }
        return next;
    });
    return changed ? { ...project, rows } : project;
}
