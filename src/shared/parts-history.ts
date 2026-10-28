// The history BOM of a list (#35): every component and supplier part-number
// combination used in the list's BOMs, kept when the BOMs change, so part
// numbers chosen before can be offered again. One component may have
// several rows, one per combination. The history isn't unified itself.

import {
    componentKey,
    definedPartNumbers,
    usedPartNumbers,
    withNewerResults,
    type ListMember
} from "./bom-list";
import {
    partNumberKey,
    type BomRow,
    type Project,
    type SupplierId
} from "./model";
import {
    addCustomColumn,
    addSupplier,
    createProject,
    createRow
} from "./project-ops";

/** The history's column with the names of the BOMs that used a row. */
export const USED_IN_COLUMN = "Used in";

export function createHistoryProject(): Project {
    return addCustomColumn(createProject(), USED_IN_COLUMN, "text").project;
}

function usedInColumn(project: Project): {
    project: Project;
    columnId: string;
} {
    const existing = project.customColumns.find(
        column => column.name.toLowerCase() === USED_IN_COLUMN.toLowerCase()
    );
    if (existing) {
        return { project, columnId: existing.id };
    }
    const added = addCustomColumn(project, USED_IN_COLUMN, "text");
    return { project: added.project, columnId: added.column.id };
}

/** Whether `entry` has every part number of `partNumbers`. */
function covers(
    entry: BomRow,
    partNumbers: Partial<Record<SupplierId, string>>
): boolean {
    return (Object.entries(partNumbers) as [SupplierId, string][]).every(
        ([supplier, partNumber]) =>
            partNumberKey(entry.partNumbers[supplier] ?? "") ===
            partNumberKey(partNumber)
    );
}

function addName(list: string | number | undefined, name: string): string {
    const names = String(list ?? "")
        .split(",")
        .map(part => part.trim())
        .filter(Boolean);
    return names.includes(name)
        ? names.join(", ")
        : [...names, name].join(", ");
}

/**
 * Adds the components of `boms` whose part numbers the history doesn't
 * have yet: a row is known when a history row of the same component has
 * all of its part numbers. Known rows get the BOM's name in "Used in".
 * Rows without a part number are left out. The history also gets newer
 * collected data of the part numbers. Returns the same object when
 * nothing changes.
 */
export function addToHistory(
    history: Project,
    boms: readonly Pick<ListMember, "name" | "project">[]
): { project: Project; added: number } {
    const { project: withColumn, columnId } = usedInColumn(history);
    let rows = [...withColumn.rows];
    let base = withColumn; // with the suppliers of added rows
    let added = 0;
    let changed = withColumn !== history;

    for (const { name, project } of boms) {
        for (const row of project.rows) {
            const partNumbers = definedPartNumbers(row);
            if (Object.keys(partNumbers).length === 0) {
                continue;
            }
            const key = componentKey(row);
            const index = rows.findIndex(
                entry =>
                    componentKey(entry) === key && covers(entry, partNumbers)
            );
            const entry = rows[index];
            if (entry) {
                const usedIn = addName(entry.custom[columnId], name);
                if (usedIn !== entry.custom[columnId]) {
                    rows[index] = {
                        ...entry,
                        custom: { ...entry.custom, [columnId]: usedIn }
                    };
                    changed = true;
                }
                continue;
            }
            rows = [
                ...rows,
                createRow({
                    value: row.value.trim(),
                    footprint: row.footprint.trim(),
                    partNumbers,
                    custom: { [columnId]: name }
                })
            ];
            for (const supplier of Object.keys(partNumbers) as SupplierId[]) {
                base = addSupplier(base, supplier);
            }
            added++;
            changed = true;
        }
    }

    let next: Project = changed ? { ...base, rows } : history;
    const used = usedPartNumbers(next);
    for (const { project } of boms) {
        next = withNewerResults(next, project.collected, used);
    }
    return { project: next, added };
}
