// What the features of a BOM list (#35) share: when rows are the same
// component, and the collected data of several BOMs.

import {
    partNumberKey,
    SUPPLIER_IDS,
    type BomRow,
    type CollectedData,
    type LookupResult,
    type Project,
    type SupplierId
} from "./model";
import { hasAlternatives, isPartNumberDefined } from "./part-number";
import { BOM_LIST_FILE_EXTENSION } from "./bom-list-file";
import { PROJECT_FILE_EXTENSION } from "./project-file";

/** A BOM of a list, with the name shown for it. */
export interface ListMember {
    /** The BOM file. */
    path: string;
    name: string;
    project: Project;
}

/** File name without folder and the extension of a BOM or a list. */
export function fileTitle(path: string): string {
    const name = path.split(/[\\/]/).pop() ?? path;
    for (const extension of [PROJECT_FILE_EXTENSION, BOM_LIST_FILE_EXTENSION]) {
        if (name.toLowerCase().endsWith(`.${extension}`)) {
            return name.slice(0, -extension.length - 1);
        }
    }
    return name;
}

function tidy(text: string): string {
    return text.trim().replace(/\s+/g, " ");
}

/** A Value compared: 10k is 10K and 100n is 100N, but m and M keep
 *  their case, since 10m (milli) isn't 10M (mega). */
function valueKey(value: string): string {
    return tidy(value).replace(/[^mM]/g, c => c.toLowerCase());
}

/**
 * Rows are the same component when Value and Footprint are equal (spaces
 * tidied up; see `valueKey` for case). Without `matchFootprint`, the Value
 * alone.
 */
export function componentKey(
    row: Pick<BomRow, "value" | "footprint">,
    matchFootprint = true
): string {
    return matchFootprint
        ? `${valueKey(row.value)}\u0000${tidy(row.footprint).toLowerCase()}`
        : valueKey(row.value);
}

/** The row's supplier part numbers that name one part: not empty, not
 *  "-", and not alternatives ("A or B"). Trimmed. */
export function definedPartNumbers(
    row: BomRow
): Partial<Record<SupplierId, string>> {
    const defined: Partial<Record<SupplierId, string>> = {};
    for (const supplier of SUPPLIER_IDS) {
        const value = row.partNumbers[supplier];
        if (isPartNumberDefined(value) && !hasAlternatives(value)) {
            defined[supplier] = value!.trim();
        }
    }
    return defined;
}

function newer(
    a: LookupResult | undefined,
    b: LookupResult | undefined
): LookupResult | undefined {
    return !a || (b && b.fetchedAt > a.fetchedAt) ? b : a;
}

/** The newest result of each part number in any of the projects. */
export function mergeCollected(projects: readonly Project[]): CollectedData {
    const results: CollectedData["results"] = {};
    for (const project of projects) {
        for (const supplier of SUPPLIER_IDS) {
            const theirs = project.collected.results[supplier];
            if (!theirs) {
                continue;
            }
            const merged = (results[supplier] ??= {});
            for (const [key, result] of Object.entries(theirs)) {
                merged[key] = newer(merged[key], result)!;
            }
        }
    }
    return { results, runs: {} };
}

/**
 * `project` with `from`'s results for the part numbers in `partNumbers`
 * that it has none of, or only older ones. The same object if nothing is
 * newer.
 */
export function withNewerResults(
    project: Project,
    from: CollectedData,
    partNumbers: Partial<Record<SupplierId, Iterable<string>>>
): Project {
    let results = project.collected.results;
    for (const supplier of SUPPLIER_IDS) {
        for (const partNumber of partNumbers[supplier] ?? []) {
            const key = partNumberKey(partNumber);
            const theirs = from.results[supplier]?.[key];
            const mine = results[supplier]?.[key];
            if (theirs && newer(mine, theirs) !== mine) {
                results = {
                    ...results,
                    [supplier]: { ...results[supplier], [key]: theirs }
                };
            }
        }
    }
    return results === project.collected.results
        ? project
        : { ...project, collected: { ...project.collected, results } };
}

/** Part numbers by supplier that the project's rows use. */
export function usedPartNumbers(
    project: Project
): Partial<Record<SupplierId, Set<string>>> {
    const used: Partial<Record<SupplierId, Set<string>>> = {};
    for (const row of project.rows) {
        for (const [supplier, partNumber] of Object.entries(
            definedPartNumbers(row)
        ) as [SupplierId, string][]) {
            (used[supplier] ??= new Set()).add(partNumber);
        }
    }
    return used;
}
