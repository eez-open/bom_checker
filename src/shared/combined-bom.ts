// The Combined BOM of a list (#35): the rows of all its BOMs for ordering
// them together, e.g. the PCBA of a device's modules. Rows with the same
// supplier part numbers are merged and their quantities added up, for one
// device: with how many of each BOM it has, except for one-time items
// (#53). Its build quantity is the number of devices (#39); the BOMs' own
// build quantities don't count.
// Suppliers without an API come along with what was typed for them (#48).

import {
    componentKey,
    definedPartNumbers,
    mergeCollected,
    type ListMember
} from "./bom-list";
import { partNumberKey, type BomRow, type Project } from "./model";
import {
    addCustomColumn,
    addSupplier,
    createProject,
    uniqueColumnName
} from "./project-ops";

/** The Combined BOM's column with the BOMs each row comes from. */
export const SOURCE_BOM_COLUMN = "Source BOM";

/** Rows with the same part numbers merge; rows without any, by Value and
 *  Footprint. */
function mergeKey(row: BomRow): string {
    const partNumbers = Object.entries(definedPartNumbers(row));
    return partNumbers.length > 0
        ? partNumbers
              .map(([supplier, value]) => `${supplier}=${partNumberKey(value)}`)
              .join("\u0000")
        : `\u0001${componentKey(row)}`;
}

interface Merged {
    row: BomRow;
    /** References by BOM name. */
    references: Map<string, string[]>;
    /** How much of the quantity each BOM has (by index in the list). */
    sources: Map<number, number>;
}

/** Of a Combined BOM's row: how much of its quantity each BOM has, by
 *  index in the list. */
export type RowSources = ReadonlyMap<number, number>;

function referencesText(references: Map<string, string[]>): string {
    const parts = [...references].filter(([, refs]) => refs.length > 0);
    return parts.length === 1
        ? parts[0]![1].join(", ")
        : parts
              .map(([name, refs]) => `${refs.join(", ")} (${name})`)
              .join("; ");
}

/** Adds `row`'s offers of suppliers without an API to `target`, by the
 *  Combined BOM's supplier ids; values already there are kept. */
function mergeManual(
    target: BomRow,
    row: BomRow,
    combinedIds: ReadonlyMap<string, string>
): void {
    for (const [id, offer] of Object.entries(row.manual ?? {})) {
        const combinedId = combinedIds.get(id);
        if (combinedId) {
            const manual = (target.manual ??= {});
            manual[combinedId] = { ...offer, ...manual[combinedId] };
        }
    }
}

export function combineBoms(
    members: readonly ListMember[],
    buildQuantity = 1
): Project {
    return combineBomsWithSources(members, buildQuantity).project;
}

/** The Combined BOM, with where each row's quantity comes from, by row
 *  id. */
export function combineBomsWithSources(
    members: readonly ListMember[],
    buildQuantity = 1
): { project: Project; sources: Map<string, RowSources> } {
    const { project: base, column } = addCustomColumn(
        createProject(),
        SOURCE_BOM_COLUMN,
        "text"
    );
    let project = base;
    const merged = new Map<string, Merged>();
    // Suppliers without an API by name: the same shop in several BOMs is
    // one supplier.
    const manualByName = new Map<string, string>();

    for (const [
        index,
        { name, project: bom, perDevice }
    ] of members.entries()) {
        for (const supplier of bom.suppliers) {
            project = addSupplier(project, supplier);
        }
        const combinedIds = new Map<string, string>();
        for (const supplier of bom.manualSuppliers) {
            const key = supplier.name.trim().toLowerCase();
            let id = manualByName.get(key);
            if (!id) {
                id = `combined-manual-${manualByName.size + 1}`;
                manualByName.set(key, id);
                project = {
                    ...project,
                    manualSuppliers: [
                        ...project.manualSuppliers,
                        { id, name: uniqueColumnName(project, supplier.name) }
                    ]
                };
            }
            combinedIds.set(supplier.id, id);
        }
        for (const row of bom.rows) {
            const key = mergeKey(row);
            // A one-time item (#53) is needed once, however many of the
            // BOM a device has.
            const oneTime = Object.values(row.manual ?? {}).some(
                offer => offer.oneTime
            );
            const qty = oneTime ? row.qty : row.qty * perDevice;
            const reference = row.reference.trim();
            let entry = merged.get(key);
            if (!entry) {
                entry = {
                    row: {
                        id: `combined-${merged.size + 1}`,
                        reference: "",
                        value: row.value,
                        qty: 0,
                        footprint: row.footprint,
                        partNumbers: { ...row.partNumbers },
                        custom: {}
                    },
                    references: new Map(),
                    sources: new Map()
                };
                merged.set(key, entry);
            }
            entry.row.qty += qty;
            entry.sources.set(index, (entry.sources.get(index) ?? 0) + qty);
            mergeManual(entry.row, row, combinedIds);
            const references = entry.references.get(name) ?? [];
            if (reference) {
                references.push(reference);
            }
            entry.references.set(name, references);
        }
    }

    return {
        project: {
            ...project,
            buildQuantity,
            rows: [...merged.values()].map(({ row, references }) => ({
                ...row,
                // Floating-point sums such as 0.1 + 0.2.
                qty: Number(row.qty.toFixed(9)),
                reference: referencesText(references),
                custom: { [column.id]: [...references.keys()].join(", ") }
            })),
            collected: mergeCollected(members.map(member => member.project))
        },
        sources: new Map(
            [...merged.values()].map(({ row, sources }) => [row.id, sources])
        )
    };
}
