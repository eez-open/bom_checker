import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { CsvTable } from "../../shared/csv-import";
import type { KicadUpdateRequest } from "../../shared/ipc";
import { loadKicadProject, readKicadDesign } from "./project";
import { applyEdits, planKicadUpdate } from "./update";

const EXAMPLE = join(__dirname, "../../../test-fixtures/kicad/dib-dcp405plus");
const PROJECT = join(EXAMPLE, "EEZ DIB DCP405plus.kicad_pro");

const original = new Map<string, string>();
function readGzipped(path: string): Promise<string> {
    if (!original.has(path)) {
        original.set(
            path,
            gunzipSync(readFileSync(`${path}.gz`)).toString("utf8")
        );
    }
    return Promise.resolve(original.get(path)!);
}

const COLUMNS: KicadUpdateRequest["columns"] = [
    { key: "pn:digikey", label: "DigiKey", supplier: "digikey" },
    { key: "pn:mouser", label: "Mouser", supplier: "mouser" },
    { key: "pn:tme", label: "TME", supplier: "tme" },
    { key: "pn:lcsc", label: "LCSC", supplier: "lcsc" }
];
const HEADERS: Record<string, string> = {
    "pn:digikey": "DigiKey",
    "pn:mouser": "Mouser",
    "pn:tme": "TME",
    "pn:lcsc": "LCSC"
};

/** The BOM as imported: the variant's table as update rows. */
async function importedRows(variant: string) {
    const project = await loadKicadProject(PROJECT, readGzipped);
    const table = project.variants.find(v => v.name === variant)!.table;
    return { table, rows: toRows(table) };
}

function toRows(table: CsvTable): KicadUpdateRequest["rows"] {
    const index = (name: string) => table.headers.indexOf(name);
    return table.rows.map(row => ({
        reference: row[index("Reference")]!,
        values: Object.fromEntries(
            Object.entries(HEADERS).map(([key, header]) => [
                key,
                row[index(header)] ?? ""
            ])
        )
    }));
}

function cellOf(table: CsvTable, reference: string, header: string): string {
    const row = table.rows.find(r =>
        r[table.headers.indexOf("Reference")]!.split(",").includes(reference)
    );
    return row?.[table.headers.indexOf(header)] ?? "";
}

describe("updating a KiCad project", () => {
    it("changes nothing when the BOM is as imported", async () => {
        const design = await readKicadDesign(PROJECT, readGzipped);
        const { table, rows } = await importedRows("Default");
        const { plan, edits } = planKicadUpdate(design, {
            projectPath: PROJECT,
            variant: "Default",
            columns: COLUMNS,
            rows
        });
        expect(plan.matchedRows).toBe(table.rows.length);
        expect(plan.skipped).toEqual([]);
        expect(plan.changes).toEqual([]);
        expect(edits.size).toBe(0);
        expect(plan.columns.map(c => [c.label, c.field, c.newField])).toEqual([
            ["DigiKey", "DigiKey", false],
            ["Mouser", "Mouser", false],
            ["TME", "TME", false],
            ["LCSC", "LCSC", false]
        ]);
    });

    it("writes a changed part number to every symbol of the row", async () => {
        const design = await readKicadDesign(PROJECT, readGzipped);
        const { table, rows } = await importedRows("Default");
        const c1 = rows.find(row => row.reference.split(",").includes("C1"))!;
        c1.values["pn:mouser"] = "81-NEW-PART";
        c1.values["pn:lcsc"] = "C1234";

        const { plan, edits } = planKicadUpdate(design, {
            projectPath: PROJECT,
            variant: "Default",
            columns: COLUMNS,
            rows
        });
        expect(plan.changes).toEqual([
            {
                key: "pn:mouser",
                references: "C1,C2,C3,C4,C32,C59",
                field: "Mouser",
                from: "81-GRT1885C2A102JA2D",
                to: "81-NEW-PART"
            },
            {
                key: "pn:lcsc",
                references: "C1,C2,C3,C4,C32,C59",
                field: "LCSC",
                from: "",
                to: "C1234"
            }
        ]);

        // Read the changed files back: only that row differs.
        const changed = applyEdits(edits, original);
        const after = await loadKicadProject(PROJECT, path =>
            Promise.resolve(changed.get(path) ?? original.get(path)!)
        );
        const newTable = after.variants[0]!.table;
        expect(cellOf(newTable, "C1", "Mouser")).toBe("81-NEW-PART");
        expect(cellOf(newTable, "C59", "LCSC")).toBe("C1234");
        expect(newTable.rows).toHaveLength(table.rows.length);
        const others = (t: CsvTable) =>
            t.rows.filter(row => !row[0]!.split(",").includes("C1"));
        expect(others(newTable)).toEqual(others(table));
    });

    it("skips rows whose references don't match KiCad's", async () => {
        const design = await readKicadDesign(PROJECT, readGzipped);
        const { plan } = planKicadUpdate(design, {
            projectPath: PROJECT,
            variant: "Default",
            columns: COLUMNS,
            rows: [
                { reference: "C1, C2", values: { "pn:mouser": "X" } },
                { reference: "R9999", values: { "pn:mouser": "X" } },
                { reference: "R16", values: { "pn:mouser": "X" } }
            ]
        });
        expect(plan.matchedRows).toBe(0);
        expect(plan.skipped).toEqual([
            {
                references: "C1,C2",
                reason: "KiCad's rows are now C1,C2,C3,C4,C32,C59."
            },
            {
                references: "R9999",
                reason: "R9999 not in the KiCad project."
            },
            {
                references: "R16",
                reason: "R16 not in the Default BOM (DNP or excluded)."
            }
        ]);
    });

    it("changes a variant's own part number in that variant", async () => {
        const design = await readKicadDesign(PROJECT, readGzipped);
        const { rows } = await importedRows("Basic");
        const r16 = rows.find(row => row.reference.split(",").includes("R16"))!;
        r16.values["pn:digikey"] = "311-NEW-ND";

        const { plan, edits } = planKicadUpdate(design, {
            projectPath: PROJECT,
            variant: "Basic",
            columns: COLUMNS,
            rows
        });
        expect(plan.changes).toMatchObject([
            { field: "DigiKey", from: "311-0.0HRCT-ND", to: "311-NEW-ND" }
        ]);
        expect(
            [...edits.values()].flat().map(edit => edit.target.kind)
        ).toEqual(r16.reference.split(",").map(() => "variant"));
        expect(plan.warnings).toEqual([]);

        const changed = applyEdits(edits, original);
        const after = await loadKicadProject(PROJECT, path =>
            Promise.resolve(changed.get(path) ?? original.get(path)!)
        );
        const basic = after.variants.find(v => v.name === "Basic")!.table;
        expect(cellOf(basic, "R16", "DigiKey")).toBe("311-NEW-ND");
    });

    it("warns that a field without an override changes all variants", async () => {
        const design = await readKicadDesign(PROJECT, readGzipped);
        const { rows } = await importedRows("Basic");
        rows.find(row => row.reference.split(",").includes("C1"))!.values[
            "pn:mouser"
        ] = "81-NEW-PART";
        const { plan } = planKicadUpdate(design, {
            projectPath: PROJECT,
            variant: "Basic",
            columns: COLUMNS,
            rows
        });
        expect(plan.warnings).toEqual([
            "Fields without a Basic override are changed in the symbols themselves, so the other variants get the new values too."
        ]);
    });

    it("writes only the chosen columns", async () => {
        const design = await readKicadDesign(PROJECT, readGzipped);
        const { rows } = await importedRows("Default");
        const c1 = rows.find(row => row.reference.split(",").includes("C1"))!;
        c1.values["pn:mouser"] = "81-NEW-PART";
        c1.values["pn:tme"] = "NEW-TME";
        const { plan } = planKicadUpdate(
            design,
            {
                projectPath: PROJECT,
                variant: "Default",
                columns: COLUMNS,
                rows
            },
            new Set(["pn:tme"])
        );
        expect(plan.changes.map(c => c.field)).toEqual(["TME"]);
    });
});
