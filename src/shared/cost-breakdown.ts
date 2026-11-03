// The rows that cost the most at their best price, for the chart of the
// most expensive parts (#28), and what each BOM of a list costs (#54).

import type { ListMember } from "./bom-list";
import { combineBomsWithSources } from "./combined-bom";
import type { Project, SupplierId } from "./model";
import { bestSupplier, hasSupplierData } from "./pricing";
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
    /** Rows with supplier data but no supplier that has enough stock, which
     *  the total leaves out (#49). */
    uncovered: number;
}

export function costBreakdown(
    project: Project,
    preference: readonly SupplierId[],
    limit = COST_CHART_LIMIT
): CostBreakdown {
    let uncovered = 0;
    const priced = project.rows.flatMap(row => {
        const best = bestSupplier(
            row,
            project.collected,
            project.suppliers,
            preference,
            project.buildQuantity,
            project.manualSuppliers
        );
        if (!best && hasSupplierData(row, project)) {
            uncovered++;
        }
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
        total,
        uncovered
    };
}

/** What one BOM of a list costs in the Combined BOM (#54). */
export interface BomCost {
    path: string;
    name: string;
    /** How many of the BOM one device has. */
    perDevice: number;
    /** In the base currency, for the list's number of devices. */
    total: number;
    /** Share of the Combined BOM's best price total, 0 to 1. */
    share: number;
}

export interface BomCostBreakdown {
    /** The BOMs that cost the most, most expensive first. */
    items: BomCost[];
    /** The other BOMs with a price, added up; null if there are none. */
    other: { boms: number; total: number; share: number } | null;
    /** The Combined BOM's best price total. */
    total: number;
    /** Rows of the Combined BOM with supplier data but no supplier that
     *  has enough stock, which the total leaves out. */
    uncovered: number;
}

/**
 * What each BOM of a list costs when they're ordered together (#54): every
 * row of the Combined BOM at its best price, shared among the BOMs by how
 * much of its quantity each has. The BOMs' costs add up to the Combined
 * BOM's best price total; BOMs without a price are left out.
 */
export function bomCostBreakdown(
    members: readonly ListMember[],
    buildQuantity: number,
    preference: readonly SupplierId[],
    limit = COST_CHART_LIMIT
): BomCostBreakdown {
    const { project, sources } = combineBomsWithSources(members, buildQuantity);
    const totals = members.map(() => 0);
    let uncovered = 0;
    for (const row of project.rows) {
        const best = bestSupplier(
            row,
            project.collected,
            project.suppliers,
            preference,
            project.buildQuantity,
            project.manualSuppliers
        );
        if (!best) {
            uncovered += hasSupplierData(row, project) ? 1 : 0;
            continue;
        }
        const from = sources.get(row.id) ?? new Map<number, number>();
        const qty = [...from.values()].reduce((sum, part) => sum + part, 0);
        for (const [index, part] of from) {
            totals[index]! += qty > 0 ? (best.line.total * part) / qty : 0;
        }
    }
    const total = totals.reduce((sum, amount) => sum + amount, 0);
    const share = (amount: number) => (total > 0 ? amount / total : 0);
    const priced = members
        .map((member, index) => ({
            path: member.path,
            name: member.name,
            perDevice: member.perDevice,
            total: totals[index]!,
            share: share(totals[index]!)
        }))
        .filter(cost => cost.total > 0)
        // Stable: equal totals keep the list's order.
        .sort((a, b) => b.total - a.total);
    const rest = priced.slice(limit);
    const otherTotal = rest.reduce((sum, cost) => sum + cost.total, 0);
    return {
        items: priced.slice(0, limit),
        other:
            rest.length > 0
                ? {
                      boms: rest.length,
                      total: otherTotal,
                      share: share(otherTotal)
                  }
                : null,
        total,
        uncovered
    };
}
