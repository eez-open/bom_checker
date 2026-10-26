// Reads what the BOM needs from one .kicad_sch file: placed symbols with
// their instances and variant overrides, and sub-sheets.

import { atom, child, children, flag, parseSExpr, type SList } from "./sexpr";

/** A variant's changes to a symbol or sheet; missing values inherit. */
export interface VariantOverride {
    dnp?: boolean;
    excludeFromBom?: boolean;
    /** Field values that differ in this variant. */
    fields: Record<string, string>;
}

export interface SymbolInstance {
    /** Sheet path the symbol is placed in, e.g. "/<root uuid>/<sheet uuid>". */
    path: string;
    reference: string;
    unit: number;
    variants: Record<string, VariantOverride>;
}

export interface PlacedSymbol {
    libId: string;
    dnp: boolean;
    inBom: boolean;
    properties: Record<string, string>;
    instances: SymbolInstance[];
}

export interface SheetReference {
    uuid: string;
    name: string;
    /** Relative to the folder of the schematic that contains the sheet. */
    file: string;
    dnp: boolean;
    inBom: boolean;
    /** Keyed by the path of the parent sheet. */
    instances: Record<string, Record<string, VariantOverride>>;
}

export interface Schematic {
    version: number;
    uuid: string;
    symbols: PlacedSymbol[];
    sheets: SheetReference[];
    /** Variant names used in this file. */
    variantNames: Set<string>;
}

export class SchematicError extends Error {
    override name = "SchematicError";
}

export function parseSchematic(text: string): Schematic {
    const root = parseSExpr(text);
    if (root[0] !== "kicad_sch") {
        throw new SchematicError("This isn't a KiCad schematic file.");
    }
    const variantNames = new Set<string>();

    const readVariants = (path: SList): Record<string, VariantOverride> => {
        const variants: Record<string, VariantOverride> = {};
        for (const variant of children(path, "variant")) {
            const name = atom(variant, "name");
            if (!name) {
                continue;
            }
            variantNames.add(name);
            const inBom = flag(variant, "in_bom");
            variants[name] = {
                dnp: flag(variant, "dnp"),
                excludeFromBom: inBom === undefined ? undefined : !inBom,
                fields: Object.fromEntries(
                    children(variant, "field").flatMap(field => {
                        const fieldName = atom(field, "name");
                        return fieldName === undefined
                            ? []
                            : [[fieldName, atom(field, "value") ?? ""]];
                    })
                )
            };
        }
        return variants;
    };

    const instancePaths = (item: SList): SList[] =>
        children(child(item, "instances") ?? [], "project").flatMap(project =>
            children(project, "path")
        );

    const properties = (item: SList): Record<string, string> =>
        Object.fromEntries(
            children(item, "property").flatMap(property =>
                typeof property[1] === "string" &&
                typeof property[2] === "string"
                    ? [[property[1], property[2]]]
                    : []
            )
        );

    const symbols = children(root, "symbol").map((symbol): PlacedSymbol => ({
        libId: atom(symbol, "lib_id") ?? "",
        dnp: flag(symbol, "dnp") ?? false,
        inBom: flag(symbol, "in_bom") ?? true,
        properties: properties(symbol),
        instances: instancePaths(symbol).map(path => ({
            path: typeof path[1] === "string" ? path[1] : "",
            reference: atom(path, "reference") ?? "",
            unit: Number(atom(path, "unit") ?? 1),
            variants: readVariants(path)
        }))
    }));

    const sheets = children(root, "sheet").map((sheet): SheetReference => {
        const sheetProperties = properties(sheet);
        return {
            uuid: atom(sheet, "uuid") ?? "",
            name: sheetProperties.Sheetname ?? "",
            file: sheetProperties.Sheetfile ?? "",
            dnp: flag(sheet, "dnp") ?? false,
            inBom: flag(sheet, "in_bom") ?? true,
            instances: Object.fromEntries(
                instancePaths(sheet).map(path => [
                    typeof path[1] === "string" ? path[1] : "",
                    readVariants(path)
                ])
            )
        };
    });

    return {
        version: Number(atom(root, "version") ?? 0),
        uuid: atom(root, "uuid") ?? "",
        symbols,
        sheets,
        variantNames
    };
}
