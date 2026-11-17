// Ordering more than needed, up to a price break, where that costs less in
// total (#86): 10 resistors at 0.02 instead of 5 at 0.10. The rows it would
// pay for are offered, and the user confirms each (`BomRow.buyToBreak`);
// pricing.ts then raises their order quantities.

import type { BomRow, Project, SupplierId } from "./model";
import {
    bestSupplier,
    manualLine,
    supplierLine,
    type SupplierLine
} from "./pricing";

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
    /** The best price for the quantity needed; of a row whose best price
     *  stays (`changesBest`), the supplier's own price for it. */
    needed: BreakOrder;
    /** The best price when more is ordered, up to a price break; maybe at
     *  another supplier. */
    atBreak: BreakOrder;
    /** `needed.total` − `atBreak.total`. */
    saving: number;
    /** False when only a supplier that hasn't the best price costs less
     *  at a price break, and still more than the best: ordering so changes
     *  that supplier's columns, not the best price. */
    changesBest: boolean;
    /** The row is ordered up to price breaks already. */
    confirmed: boolean;
}

/** The supplier's line whose price break costs the least, of a row whose
 *  best price no price break beats. */
function supplierBreak(
    row: BomRow,
    project: Project
): { supplier: string; line: SupplierLine } | null {
    const lines = [
        ...project.suppliers.map(supplier => ({
            supplier: String(supplier),
            line: supplierLine(
                row,
                supplier,
                project.collected,
                project.buildQuantity
            )
        })),
        ...project.manualSuppliers.map(supplier => ({
            supplier: supplier.id,
            line: manualLine(row, supplier, project.buildQuantity)
        }))
    ];
    let found: { supplier: string; line: SupplierLine } | null = null;
    for (const { supplier, line } of lines) {
        if (
            line?.cheaper &&
            line.total !== null &&
            (!found || line.cheaper.total < found.line.cheaper!.total)
        ) {
            found = { supplier, line };
        }
    }
    return found;
}

/**
 * The rows that cost less when more is ordered, also those that are
 * ordered so already, in the BOM's order: every row with a blue or green
 * Order Qty cell whose prices are in the base currency.
 */
export function breakOffers(
    project: Project,
    preference: readonly SupplierId[]
): BreakOffer[] {
    return project.rows.flatMap((row, index): BreakOffer[] => {
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
        const base = {
            rowId: row.id,
            rowNumber: index + 1,
            reference: row.reference,
            value: row.value,
            confirmed: row.buyToBreak === true
        };
        if (!best?.cheaper) {
            const own = supplierBreak(plain, project);
            if (!own) {
                return [];
            }
            const { line } = own;
            const total = line.total!;
            return [
                {
                    ...base,
                    needed: {
                        supplier: own.supplier,
                        orderQty: line.orderQty!,
                        unitPrice: line.unitPrice!,
                        total
                    },
                    atBreak: { supplier: own.supplier, ...line.cheaper! },
                    saving: total - line.cheaper!.total,
                    changesBest: false
                }
            ];
        }
        const { line, cheaper } = best;
        return [
            {
                ...base,
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
                changesBest: true
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
