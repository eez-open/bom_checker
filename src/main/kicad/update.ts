// Writes BOM columns (supplier part numbers, custom columns) back into the
// KiCad project the BOM was imported from. A BOM row is used only when its
// references are exactly those of a row of KiCad's own BOM for the variant,
// so nothing is written to parts that changed in KiCad since the import.

import { relative } from "node:path";
import type { KicadUpdatePlan, KicadUpdateRequest } from "../../shared/ipc";
import { joinReferences, splitReferences } from "../../shared/references";
import { SUPPLIERS } from "../../shared/suppliers";
import { editFields, type FieldEdit, type FieldTarget } from "./edit";
import {
    DEFAULT_VARIANT,
    KicadError,
    variantParts,
    type KicadDesign
} from "./project";
import { parseSchematic } from "./schematic";

export interface KicadUpdate {
    plan: KicadUpdatePlan;
    /** Edits per schematic file, with the column each comes from. */
    edits: Map<string, (FieldEdit & { column: string })[]>;
}

const referenceKey = joinReferences;

/** A field's value as the BOM shows it: trimmed (the import trims cells),
 *  with KiCad's "~" for empty. Values that differ only in spaces count as
 *  the same, so KiCad's text is kept unless the value really changed. */
function bomValue(value: string | undefined): string {
    const trimmed = value?.trim() ?? "";
    return trimmed === "~" ? "" : trimmed;
}

/** The KiCad field a column goes to; null if it can't be written. */
function resolveField(
    column: KicadUpdateRequest["columns"][number],
    fieldNames: ReadonlySet<string>,
    warnings: string[]
): { field: string; newField: boolean } | null {
    if (column.supplier) {
        const supplier = SUPPLIERS[column.supplier];
        const names = [...fieldNames];
        const exact = names.find(
            name => name.toLowerCase() === supplier.name.toLowerCase()
        );
        if (exact) {
            return { field: exact, newField: false };
        }
        const matching = names.filter(name =>
            supplier.headerPattern.test(name)
        );
        if (matching.length > 1) {
            warnings.push(
                `${column.label} isn't written: the project has several fields for it (${matching.join(", ")}).`
            );
            return null;
        }
        return matching.length === 1
            ? { field: matching[0]!, newField: false }
            : { field: supplier.name, newField: true };
    }
    return column.field && fieldNames.has(column.field)
        ? { field: column.field, newField: false }
        : null;
}

export function planKicadUpdate(
    design: KicadDesign,
    request: KicadUpdateRequest,
    only?: ReadonlySet<string>
): KicadUpdate {
    const { variant } = request;
    if (!design.variantNames.includes(variant)) {
        throw new KicadError(
            `The KiCad project has no "${variant}" variant any more.`
        );
    }
    const warnings: string[] = [];
    const { groups } = variantParts(design, variant);

    // KiCad's rows, and every reference in the project.
    const kicadRows = new Map(
        groups.map(group => [
            referenceKey(group.map(part => part.reference)),
            group
        ])
    );
    const groupOf = new Map(
        groups.flatMap(group => group.map(part => [part.reference, group]))
    );
    const allReferences = new Set(
        design.units.flatMap(unit =>
            unit.symbol.instances.map(instance => instance.reference)
        )
    );

    const fieldNames = new Set(
        design.units.flatMap(unit => Object.keys(unit.symbol.properties))
    );
    const columns = request.columns.flatMap(column => {
        const resolved = resolveField(column, fieldNames, warnings);
        return resolved && (!only || only.has(column.key))
            ? [{ ...column, ...resolved, changes: 0 }]
            : [];
    });

    // References used by more than one BOM row can't be matched.
    const rowCount = new Map<string, number>();
    for (const row of request.rows) {
        for (const reference of splitReferences(row.reference)) {
            rowCount.set(reference, (rowCount.get(reference) ?? 0) + 1);
        }
    }

    const plan: KicadUpdatePlan = {
        projectName: design.name,
        variant,
        columns: [],
        changes: [],
        matchedRows: 0,
        skipped: [],
        warnings
    };
    // Each place in a file gets one value; a sheet used several times can
    // put one symbol in two rows, which may want different values.
    const targets = new Map<
        string,
        { file: string; target: FieldTarget; value: string; column: string }
    >();
    const conflicts = new Set<string>();

    for (const row of request.rows) {
        const references = splitReferences(row.reference);
        if (references.length === 0) {
            continue;
        }
        const skip = (reason: string) =>
            plan.skipped.push({ references: references.join(","), reason });
        const repeated = references.filter(r => (rowCount.get(r) ?? 0) > 1);
        if (repeated.length > 0) {
            skip(`${repeated.join(", ")} also in another row.`);
            continue;
        }
        const group = kicadRows.get(referenceKey(references));
        if (!group) {
            const missing = references.filter(r => !allReferences.has(r));
            const notInBom = references.filter(
                r => allReferences.has(r) && !groupOf.has(r)
            );
            if (missing.length > 0) {
                skip(`${missing.join(", ")} not in the KiCad project.`);
            } else if (notInBom.length > 0) {
                skip(
                    `${notInBom.join(", ")} not in the ${variant} BOM (DNP or excluded).`
                );
            } else {
                const kicad = [
                    ...new Set(references.map(r => groupOf.get(r)!))
                ].map(g => g.map(part => part.reference).join(","));
                skip(`KiCad's rows are now ${kicad.join(" | ")}.`);
            }
            continue;
        }
        plan.matchedRows++;

        for (const column of columns) {
            const value = (row.values[column.key] ?? "").trim();
            let changed = false;
            for (const part of group) {
                for (const unit of part.units) {
                    const instance = unit.symbol.instances.find(
                        i => i.path === unit.sheetPath
                    );
                    const override =
                        variant === DEFAULT_VARIANT
                            ? undefined
                            : instance?.variants[variant]?.fields;
                    const target: FieldTarget =
                        override && column.field in override
                            ? {
                                  kind: "variant",
                                  symbol: unit.symbol.uuid,
                                  path: unit.sheetPath,
                                  variant,
                                  field: column.field
                              }
                            : {
                                  kind: "property",
                                  symbol: unit.symbol.uuid,
                                  field: column.field
                              };
                    const current =
                        target.kind === "variant"
                            ? override![column.field]
                            : unit.symbol.properties[column.field];
                    if (bomValue(current) === value) {
                        continue;
                    }
                    const key = `${unit.file}\n${JSON.stringify(target)}`;
                    const earlier = targets.get(key);
                    if (earlier && earlier.value !== value) {
                        conflicts.add(key);
                    }
                    targets.set(key, {
                        file: unit.file,
                        target,
                        value,
                        column: column.key
                    });
                    changed = true;
                }
            }
            if (changed) {
                column.changes++;
                plan.changes.push({
                    key: column.key,
                    references: group.map(part => part.reference).join(","),
                    field: column.field,
                    from: bomValue(group[0]!.fields[column.field]),
                    to: value
                });
            }
        }
    }

    const edits = new Map<string, (FieldEdit & { column: string })[]>();
    let sharedSymbols = 0;
    for (const [key, { file, target, value, column }] of targets) {
        if (conflicts.has(key)) {
            sharedSymbols++;
            continue;
        }
        edits.set(file, [
            ...(edits.get(file) ?? []),
            { target, value, column }
        ]);
    }
    if (sharedSymbols > 0) {
        warnings.push(
            `${sharedSymbols} fields were left unchanged: their symbol is on a sheet used more than once, ` +
                "and its rows ask for different values."
        );
    }
    if (
        variant !== DEFAULT_VARIANT &&
        [...edits.values()].flat().some(edit => edit.target.kind === "property")
    ) {
        warnings.push(
            `Fields without a ${variant} override are changed in the symbols themselves, ` +
                `so the other variants get the new values too.`
        );
    }
    plan.columns = columns.map(({ key, label, field, newField, changes }) => ({
        key,
        label,
        field,
        newField,
        changes
    }));
    return { plan, edits };
}

/** The files' new text; checks each one by reading it back. */
export function applyEdits(
    edits: KicadUpdate["edits"],
    texts: ReadonlyMap<string, string>
): Map<string, string> {
    const result = new Map<string, string>();
    for (const [file, fileEdits] of edits) {
        const text = editFields(texts.get(file)!, fileEdits);
        const schematic = parseSchematic(text);
        for (const { target, value } of fileEdits) {
            const symbol = schematic.symbols.find(
                s => s.uuid === target.symbol
            );
            const written =
                target.kind === "property"
                    ? symbol?.properties[target.field]
                    : symbol?.instances.find(i => i.path === target.path)
                          ?.variants[target.variant]?.fields[target.field];
            if (written !== value) {
                throw new KicadError(
                    `Checking the changed "${file}" failed; nothing was written.`
                );
            }
        }
        result.set(file, text);
    }
    return result;
}

/** Paths relative to the project folder, for messages. */
export function relativeFiles(
    projectFolder: string,
    files: Iterable<string>
): string[] {
    return [...files].map(file => relative(projectFolder, file));
}
