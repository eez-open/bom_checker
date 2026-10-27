// The rows that cost the most at their best price, for the chart of the
// most expensive parts (#28).

import type { Project, SupplierId } from "./model";
import { bestSupplier } from "./pricing";
import { supplierName } from "./suppliers";

export const COST_CHART_LIMIT = 10;

export interface CostItem {
    rowId: string;
    reference: string;
    value: string;
    /** Name of the supplier with the best price. */
    supplier: string;
    /** Best total price for the build quantity, in the base currency. */
    total: number;
    /** Share of the BOM's best price total, 0 to 1. */
    share: number;
}

export interface CostBreakdown {
    /** The most expensive rows, most expensive first. */
    items: CostItem[];
    /** The other rows with a price, added up; null if there are none. */
    other: { rows: number; total: number; share: number } | null;
    /** The BOM's best price total (as in the status bar). */
    total: number;
}

export function costBreakdown(
    project: Project,
    preference: readonly SupplierId[],
    limit = COST_CHART_LIMIT
): CostBreakdown {
    const priced = project.rows.flatMap(row => {
        const best = bestSupplier(
            row,
            project.collected,
            project.suppliers,
            preference,
            project.buildQuantity,
            project.manualSuppliers
        );
        return best && best.line.total > 0 ? [{ row, best }] : [];
    });
    const total = priced.reduce((sum, { best }) => sum + best.line.total, 0);
    const share = (amount: number) => (total > 0 ? amount / total : 0);
    // Stable: equal totals keep the BOM's order.
    priced.sort((a, b) => b.best.line.total - a.best.line.total);

    const items = priced.slice(0, limit).map(({ row, best }) => ({
        rowId: row.id,
        reference: row.reference,
        value: row.value,
        supplier: supplierName(project, best.supplier),
        total: best.line.total,
        share: share(best.line.total)
    }));
    const rest = priced.slice(limit);
    const otherTotal = rest.reduce((sum, { best }) => sum + best.line.total, 0);
    return {
        items,
        other:
            rest.length > 0
                ? {
                      rows: rest.length,
                      total: otherTotal,
                      share: share(otherTotal)
                  }
                : null,
        total
    };
}
