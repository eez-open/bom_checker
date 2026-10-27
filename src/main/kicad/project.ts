// Builds the BOM of a KiCad 10 project, per design variant ("BOM checker
// architecture.md", 9.2). File access goes through `readText`, so this is
// tested on a real project without Electron.

import { basename, dirname, join } from "node:path";
import type { CsvTable } from "../../shared/csv-import";
import { compareReferences } from "../../shared/references";
import { ALL_SUPPLIERS } from "../../shared/suppliers";
import {
    parseSchematic,
    type PlacedSymbol,
    type Schematic,
    type VariantOverride
} from "./schematic";

/** KiCad 10.0's schematic format. */
export const KICAD_SCHEMATIC_VERSION = 20260306;
export const DEFAULT_VARIANT = "Default";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export class KicadError extends Error {
    override name = "KicadError";
}

export interface KicadVariantBom {
    name: string;
    /** Rows grouped like KiCad's Symbol Fields Table. */
    table: CsvTable;
    /** Placed parts in the BOM (Qty total). */
    partCount: number;
    warnings: string[];
}

export interface KicadProject {
    name: string;
    path: string;
    variants: KicadVariantBom[];
    /** Problems that apply to all variants, e.g. a newer file format. */
    warnings: string[];
    /** Fields the project's own BOM settings show; null if it has none. */
    bomFields: string[] | null;
}

/** DNP and exclude-from-BOM settings of a parent sheet. */
interface SheetFlags {
    dnp: boolean;
    inBom: boolean;
    variants: Record<string, VariantOverride>;
}

export interface PlacedUnit {
    symbol: PlacedSymbol;
    file: string;
    /** Path of the sheet the symbol is placed in. */
    sheetPath: string;
    parents: SheetFlags[];
}

interface ProjectFile {
    schematic?: {
        top_level_sheets?: { filename?: string; uuid?: string }[];
        variants?: { name?: string }[];
        bom_settings?: {
            fields_ordered?: {
                name?: string;
                show?: boolean;
                group_by?: boolean;
            }[];
        };
    };
}

/** Everything read from a project, before building a variant's BOM. */
export interface KicadDesign {
    name: string;
    path: string;
    /** Schematic files by path, each read once. */
    files: Map<string, Schematic>;
    /** Every placed symbol unit, with the sheet it's placed in. */
    units: PlacedUnit[];
    variantNames: string[];
    groupFields: string[];
    fieldOrder: string[];
    bomFields: string[] | null;
    warnings: string[];
}

export async function loadKicadProject(
    projectPath: string,
    readText: (path: string) => Promise<string>
): Promise<KicadProject> {
    const design = await readKicadDesign(projectPath, readText);
    return {
        name: design.name,
        path: design.path,
        warnings: design.warnings,
        bomFields: design.bomFields,
        variants: design.variantNames.map(variant => {
            const { warnings, groups, partCount } = variantParts(
                design,
                variant
            );
            return {
                name: variant,
                table: toTable(groups, design.fieldOrder),
                partCount,
                warnings
            };
        })
    };
}

export async function readKicadDesign(
    projectPath: string,
    readText: (path: string) => Promise<string>
): Promise<KicadDesign> {
    let project: ProjectFile;
    try {
        project = JSON.parse(await readText(projectPath)) as ProjectFile;
    } catch {
        throw new KicadError("The file isn't a KiCad project (.kicad_pro).");
    }
    const folder = dirname(projectPath);
    const name = basename(projectPath).replace(/\.kicad_pro$/i, "");
    const warnings: string[] = [];

    // Read the hierarchy; each file is parsed once even if used by several sheets.
    const parsed = new Map<string, Schematic>();
    const load = async (path: string): Promise<Schematic> => {
        const cached = parsed.get(path);
        if (cached) {
            return cached;
        }
        let schematic: Schematic;
        try {
            schematic = parseSchematic(await readText(path));
        } catch (error) {
            throw new KicadError(
                `Can't read "${basename(path)}": ${error instanceof Error ? error.message : String(error)}`
            );
        }
        if (schematic.version < KICAD_SCHEMATIC_VERSION) {
            throw new KicadError(
                `"${basename(path)}" was saved by an older KiCad (file format ${schematic.version}). ` +
                    "Only KiCad 10 projects are supported: open the project in KiCad 10, save it and try again."
            );
        }
        if (schematic.version > KICAD_SCHEMATIC_VERSION) {
            warnings.push(
                `"${basename(path)}" was saved by a newer KiCad (file format ${schematic.version}). ` +
                    "Parts or variant settings it adds may be missing."
            );
        }
        parsed.set(path, schematic);
        return schematic;
    };

    const units: PlacedUnit[] = [];
    const walk = async (
        file: string,
        sheetPath: string,
        parents: SheetFlags[],
        open: string[]
    ) => {
        const schematic = await load(file);
        for (const symbol of schematic.symbols) {
            units.push({ symbol, file, sheetPath, parents });
        }
        for (const sheet of schematic.sheets) {
            const childFile = join(dirname(file), sheet.file);
            if (open.includes(childFile)) {
                warnings.push(
                    `Sheet "${sheet.name}" includes itself; it was skipped.`
                );
                continue;
            }
            await walk(
                childFile,
                `${sheetPath}/${sheet.uuid}`,
                [
                    ...parents,
                    {
                        dnp: sheet.dnp,
                        inBom: sheet.inBom,
                        variants: sheet.instances[sheetPath] ?? {}
                    }
                ],
                [...open, childFile]
            );
        }
    };

    const topSheets =
        project.schematic?.top_level_sheets?.filter(sheet => sheet.filename) ??
        [];
    if (topSheets.length === 0) {
        topSheets.push({ filename: `${name}.kicad_sch` });
    }
    for (const sheet of topSheets) {
        const file = join(folder, sheet.filename!);
        const root = await load(file);
        const uuid =
            sheet.uuid && sheet.uuid !== NIL_UUID ? sheet.uuid : root.uuid;
        await walk(file, `/${uuid}`, [], [file]);
    }

    const variantNames = [
        DEFAULT_VARIANT,
        ...(project.schematic?.variants ?? []).flatMap(v =>
            v.name ? [v.name] : []
        ),
        ...[...parsed.values()].flatMap(s => [...s.variantNames])
    ];
    const groupFields = (project.schematic?.bom_settings?.fields_ordered ?? [])
        .filter(
            field =>
                field.group_by && field.name && !field.name.startsWith("${")
        )
        .map(field => field.name!);
    const fieldOrder = (
        project.schematic?.bom_settings?.fields_ordered ?? []
    ).flatMap(f => (f.name ? [f.name] : []));

    const shown = project.schematic?.bom_settings?.fields_ordered;
    return {
        name,
        path: projectPath,
        files: parsed,
        units,
        variantNames: [...new Set(variantNames)],
        groupFields:
            groupFields.length > 0 ? groupFields : ["Value", "Footprint"],
        fieldOrder,
        bomFields: shown
            ? shown.flatMap(f =>
                  f.show && f.name && !f.name.startsWith("${") ? [f.name] : []
              )
            : null,
        warnings
    };
}

export interface Part {
    reference: string;
    included: boolean;
    /** Field values in the variant (its overrides applied). */
    fields: Record<string, string>;
    /** Units disagree about DNP or exclude from BOM. */
    mixed: boolean;
    /** All units placed with this reference. */
    units: PlacedUnit[];
}

export interface VariantParts {
    /** Parts in the variant's BOM, grouped like KiCad's Symbol Fields
     *  Table; references in natural order. */
    groups: Part[][];
    partCount: number;
    warnings: string[];
}

/** The parts of one design variant, and how they group into BOM rows. */
export function variantParts(
    design: KicadDesign,
    variant: string
): VariantParts {
    const { units, groupFields } = design;
    const warnings: string[] = [];
    const parts = new Map<string, Part>();
    const seenUnits = new Set<string>();
    let missingInstances = 0;

    for (const unit of units) {
        const { symbol, sheetPath, parents } = unit;
        const instance = symbol.instances.find(i => i.path === sheetPath);
        const reference =
            instance?.reference ?? symbol.properties.Reference ?? "";
        if (!instance) {
            missingInstances++;
        }
        // Power symbols and other virtual symbols (#PWR, #FLG…).
        if (reference.startsWith("#")) {
            continue;
        }
        const override =
            variant === DEFAULT_VARIANT
                ? undefined
                : instance?.variants[variant];
        let dnp = override?.dnp ?? symbol.dnp;
        let excluded = override?.excludeFromBom ?? !symbol.inBom;
        for (const parent of parents) {
            const parentOverride =
                variant === DEFAULT_VARIANT
                    ? undefined
                    : parent.variants[variant];
            dnp ||= parentOverride?.dnp ?? parent.dnp;
            excluded ||= parentOverride?.excludeFromBom ?? !parent.inBom;
        }
        const included = !dnp && !excluded;

        const unitKey = `${reference}/${instance?.unit ?? 1}`;
        if (seenUnits.has(unitKey) && !reference.includes("?")) {
            warnings.push(
                `${reference} is used more than once; check the annotation in KiCad.`
            );
        }
        seenUnits.add(unitKey);

        const part = parts.get(reference);
        if (part) {
            part.mixed ||= part.included !== included;
            part.included ||= included;
            part.units.push(unit);
        } else {
            const fields = { ...symbol.properties, ...override?.fields };
            delete fields.Reference;
            parts.set(reference, {
                reference,
                included,
                fields,
                mixed: false,
                units: [unit]
            });
        }
    }

    if (missingInstances > 0) {
        warnings.push(
            `${missingInstances} symbols have no reference for this sheet; their Reference field was used. ` +
                "Annotating the schematic in KiCad fixes this."
        );
    }
    for (const part of parts.values()) {
        if (part.reference.includes("?")) {
            warnings.push(
                `${part.reference} isn't annotated; annotate the schematic in KiCad.`
            );
        }
        if (part.mixed) {
            warnings.push(
                `${part.reference}: its units differ in DNP or "exclude from BOM". It is included because at least one unit is fitted.`
            );
        }
    }

    const included = [...parts.values()].filter(part => part.included);
    return {
        groups: groupParts(included, groupFields),
        partCount: included.length,
        warnings: [...new Set(warnings)]
    };
}

/** "~" is KiCad's empty value (e.g. for Datasheet). */
function fieldValue(part: Part, name: string): string {
    const value = part.fields[name] ?? "";
    return value === "~" ? "" : value;
}

function usedFields(parts: readonly Part[]): Set<string> {
    return new Set(
        parts.flatMap(part =>
            Object.keys(part.fields).filter(
                name => fieldValue(part, name) !== ""
            )
        )
    );
}

/**
 * Groups parts like KiCad's Symbol Fields Table: by the project's group-by
 * fields (Value and Footprint by default). Parts with different supplier
 * part numbers are never merged, so no part number is lost.
 */
function groupParts(
    parts: readonly Part[],
    groupFields: readonly string[]
): Part[][] {
    const supplierFields = [...usedFields(parts)].filter(name =>
        ALL_SUPPLIERS.some(s => s.headerPattern.test(name))
    );
    const keyFields = [...new Set([...groupFields, ...supplierFields])];

    const groups = new Map<string, Part[]>();
    for (const part of [...parts].sort((a, b) =>
        compareReferences(a.reference, b.reference)
    )) {
        const key = JSON.stringify(
            keyFields.map(name => fieldValue(part, name))
        );
        groups.set(key, [...(groups.get(key) ?? []), part]);
    }
    return [...groups.values()];
}

/** The BOM table: one row per group, with the fields in the project's
 *  order. */
function toTable(
    groups: readonly Part[][],
    fieldOrder: readonly string[]
): CsvTable {
    const allFields = usedFields(groups.flat());
    const ordered = [
        ...fieldOrder.filter(name => allFields.has(name)),
        ...[...allFields].filter(name => !fieldOrder.includes(name)).sort()
    ];
    const extraFields = ordered.filter(
        name => name !== "Value" && name !== "Footprint"
    );
    const headers = ["Reference", "Value", "Qty", "Footprint", ...extraFields];
    const rows = groups.map(group => {
        const distinct = (name: string) =>
            [
                ...new Set(
                    group.map(part => fieldValue(part, name)).filter(Boolean)
                )
            ].join(", ");
        return [
            group.map(part => part.reference).join(","),
            distinct("Value"),
            String(group.length),
            distinct("Footprint"),
            ...extraFields.map(distinct)
        ];
    });
    return { headers, rows };
}
