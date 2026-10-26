// CSV import: decode, parse, suggest a column mapping and build a Project.
// Pure functions, so the whole pipeline is tested without the UI.

import Papa from "papaparse";
import type {
    BaseField,
    BomRow,
    ColumnType,
    CustomValue,
    Project,
    SupplierId
} from "./model";
import { normalizeCell } from "./part-number";
import {
    addCustomColumn,
    addSupplier,
    countReferences,
    createProject,
    createRow,
    uniqueColumnName
} from "./project-ops";
import { ALL_SUPPLIERS, SUPPLIERS } from "./suppliers";

export const ENCODINGS = [
    { id: "utf-8", label: "UTF-8" },
    { id: "windows-1250", label: "Windows-1250 (Central European)" },
    { id: "windows-1252", label: "Windows-1252 (Western European)" },
    { id: "iso-8859-2", label: "ISO-8859-2 (Central European)" }
] as const;

export type Encoding = (typeof ENCODINGS)[number]["id"];

/** UTF-8 if the bytes are valid UTF-8, otherwise Windows-1250 (what Excel
 *  writes on Central European Windows). */
export function detectEncoding(bytes: Uint8Array): Encoding {
    try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return "utf-8";
    } catch {
        return "windows-1250";
    }
}

/** Decodes text; a UTF-8 byte order mark is removed. */
export function decodeText(bytes: Uint8Array, encoding: Encoding): string {
    return new TextDecoder(encoding).decode(bytes);
}

export interface CsvTable {
    headers: string[];
    /** Data rows, each padded to `headers.length` cells. */
    rows: string[][];
}

/** Parses CSV text whose first line is the header. The delimiter (comma,
 *  semicolon or tab) is detected. */
export function parseCsv(text: string): CsvTable {
    const { data } = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    const [headerRow = [], ...rows] = data;
    const width = Math.max(headerRow.length, ...rows.map(row => row.length));
    const pad = (row: string[]) =>
        Array.from({ length: width }, (_, i) => row[i] ?? "");
    return {
        headers: pad(headerRow).map(header => header.trim()),
        rows: rows.map(pad)
    };
}

export type ColumnTarget =
    | { kind: "ignore" }
    | { kind: "row" }
    | { kind: "base"; field: BaseField }
    | { kind: "partNumber"; supplier: SupplierId }
    | { kind: "custom"; type: ColumnType };

const HEADER_HINTS: [RegExp, ColumnTarget][] = [
    [/^(#|row|item|no\.?|nr\.?)$/i, { kind: "row" }],
    [
        /^(references?|refs?|ref ?des|designators?)$/i,
        { kind: "base", field: "reference" }
    ],
    [/^(values?|val)$/i, { kind: "base", field: "value" }],
    [/^(qty|quantity|count)$/i, { kind: "base", field: "qty" }],
    [/^(footprints?|packages?)$/i, { kind: "base", field: "footprint" }]
];

/** Guesses each column's meaning from its header. Unknown headers become
 *  custom text columns; each mandatory column and supplier is used once. */
export function suggestMapping(headers: readonly string[]): ColumnTarget[] {
    const used = new Set<string>();
    return headers.map(header => {
        if (header === "") {
            return { kind: "ignore" };
        }
        const candidates: ColumnTarget[] = [
            ...HEADER_HINTS.filter(([pattern]) => pattern.test(header)).map(
                ([, target]) => target
            ),
            ...ALL_SUPPLIERS.filter(s => s.headerPattern.test(header)).map(
                (s): ColumnTarget => ({ kind: "partNumber", supplier: s.id })
            )
        ];
        const target = candidates.find(c => !used.has(targetId(c)));
        if (target) {
            used.add(targetId(target));
            return target;
        }
        return { kind: "custom", type: "text" };
    });
}

/** A string id for a target, e.g. "base:qty"; also used by the UI. */
export function targetId(target: ColumnTarget): string {
    switch (target.kind) {
        case "base":
            return `base:${target.field}`;
        case "partNumber":
            return `pn:${target.supplier}`;
        case "custom":
            return `custom:${target.type}`;
        default:
            return target.kind;
    }
}

/** Problems that prevent importing with this mapping. */
export function validateMapping(mapping: readonly ColumnTarget[]): string[] {
    const errors: string[] = [];
    const ids = mapping.map(targetId);
    if (!ids.includes("base:reference") && !ids.includes("base:value")) {
        errors.push("Choose at least the Reference or the Value column.");
    }
    const seen = new Set<string>();
    for (const [index, id] of ids.entries()) {
        const target = mapping[index]!;
        if (target.kind !== "base" && target.kind !== "partNumber") {
            continue;
        }
        if (seen.has(id)) {
            errors.push(
                target.kind === "base"
                    ? `"${capitalize(target.field)}" is chosen for more than one column.`
                    : `${SUPPLIERS[target.supplier].name} part numbers are chosen for more than one column.`
            );
        }
        seen.add(id);
    }
    return [...new Set(errors)];
}

export interface CsvImport {
    project: Project;
    /** Things the user should know about, e.g. skipped values. */
    warnings: string[];
}

export function importCsv(
    table: CsvTable,
    mapping: readonly ColumnTarget[],
    source: { path: string; importedAt: string }
): CsvImport {
    let project: Project = {
        ...createProject(),
        source: { kind: "csv", ...source }
    };
    const customIds = new Map<number, string>();
    for (const [index, target] of mapping.entries()) {
        if (target.kind === "partNumber") {
            project = addSupplier(project, target.supplier);
        } else if (target.kind === "custom") {
            const name = uniqueColumnName(
                project,
                table.headers[index] || `Column ${index + 1}`
            );
            const added = addCustomColumn(project, name, target.type);
            project = added.project;
            customIds.set(index, added.column.id);
        }
    }

    let qtyFallbacks = 0;
    const skippedNumbers = new Map<string, number>();
    const rows: BomRow[] = [];
    for (const cells of table.rows) {
        if (mapping.every((t, i) => t.kind === "ignore" || !cells[i]?.trim())) {
            continue;
        }
        const row = createRow();
        let qty: number | undefined;
        for (const [index, target] of mapping.entries()) {
            const text = normalizeCell(cells[index]);
            if (target.kind === "base") {
                if (target.field === "qty") {
                    qty = /^\d+$/.test(text) ? Number(text) : undefined;
                } else {
                    row[target.field] = text;
                }
            } else if (target.kind === "partNumber" && text !== "") {
                row.partNumbers[target.supplier] = text;
            } else if (target.kind === "custom" && text !== "") {
                const value = toCustomValue(text, target.type);
                const id = customIds.get(index)!;
                if (value === undefined) {
                    skippedNumbers.set(id, (skippedNumbers.get(id) ?? 0) + 1);
                } else {
                    row.custom[id] = value;
                }
            }
        }
        if (qty === undefined) {
            qtyFallbacks++;
            qty = countReferences(row.reference) || 1;
        }
        row.qty = qty;
        rows.push(row);
    }

    const warnings: string[] = [];
    if (qtyFallbacks > 0 && mapping.some(t => targetId(t) === "base:qty")) {
        warnings.push(
            `${plural(qtyFallbacks, "row")} had no valid Qty; ` +
                "the number of references was used instead."
        );
    }
    for (const [id, count] of skippedNumbers) {
        const name = project.customColumns.find(c => c.id === id)?.name;
        warnings.push(
            count === 1
                ? `1 value in "${name}" wasn't a number and was left out.`
                : `${count} values in "${name}" weren't numbers and were left out.`
        );
    }
    return { project: { ...project, rows }, warnings };
}

function toCustomValue(
    text: string,
    type: ColumnType
): CustomValue | undefined {
    if (type === "text") {
        return text;
    }
    // Accept a decimal comma, as written by Excel in many European locales.
    return /^-?\d+([.,]\d+)?$/.test(text)
        ? Number(text.replace(",", "."))
        : undefined;
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
