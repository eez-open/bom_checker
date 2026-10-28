// The Combined BOM of a list (#35): the rows of all its BOMs for ordering
// them together, e.g. the PCBA of a device's modules. Rows with the same
// supplier part numbers are merged and their quantities added up, with
// each BOM's build quantity.

import {
    componentKey,
    definedPartNumbers,
    mergeCollected,
    type ListMember
} from "./bom-list";
import { partNumberKey, type BomRow, type Project } from "./model";
import { addCustomColumn, addSupplier, createProject } from "./project-ops";

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
}

function referencesText(references: Map<string, string[]>): string {
    const parts = [...references].filter(([, refs]) => refs.length > 0);
    return parts.length === 1
        ? parts[0]![1].join(", ")
        : parts
              .map(([name, refs]) => `${refs.join(", ")} (${name})`)
              .join("; ");
}

export function combineBoms(members: readonly ListMember[]): Project {
    const { project: base, column } = addCustomColumn(
        createProject(),
        SOURCE_BOM_COLUMN,
        "text"
    );
    let project = base;
    const merged = new Map<string, Merged>();

    for (const { name, project: bom } of members) {
        for (const supplier of bom.suppliers) {
            project = addSupplier(project, supplier);
        }
        for (const row of bom.rows) {
            const key = mergeKey(row);
            const qty = row.qty * bom.buildQuantity;
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
                    references: new Map()
                };
                merged.set(key, entry);
            }
            entry.row.qty += qty;
            const references = entry.references.get(name) ?? [];
            if (reference) {
                references.push(reference);
            }
            entry.references.set(name, references);
        }
    }

    return {
        ...project,
        rows: [...merged.values()].map(({ row, references }) => ({
            ...row,
            // Floating-point sums such as 0.1 + 0.2.
            qty: Number(row.qty.toFixed(9)),
            reference: referencesText(references),
            custom: { [column.id]: [...references.keys()].join(", ") }
        })),
        collected: mergeCollected(members.map(member => member.project))
    };
}
