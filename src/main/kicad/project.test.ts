import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeText, parseCsv, type CsvTable } from "../../shared/csv-import";
import { compareReferences } from "../../shared/references";
import { KicadError, loadKicadProject } from "./project";
import { parseSExpr } from "./sexpr";

const EXAMPLE = join(__dirname, "../../../test-fixtures/kicad/dib-dcp405plus");
const EXAMPLE_PROJECT = join(EXAMPLE, "EEZ DIB DCP405plus.kicad_pro");
const BOM_CSV = join(__dirname, "../../../BOM example.csv");

const readGzipped = (path: string) =>
    Promise.resolve(gunzipSync(readFileSync(`${path}.gz`)).toString("utf8"));

const FIELDS = ["Value", "Footprint", "DigiKey", "Mouser", "TME", "LCSC"];

/** Fields per reference, from a grouped table. */
function byReference(table: CsvTable): Map<string, Record<string, string>> {
    const index = (name: string) => table.headers.indexOf(name);
    const parts = new Map<string, Record<string, string>>();
    for (const row of table.rows) {
        const fields = Object.fromEntries(
            FIELDS.map(name => [name, row[index(name)] ?? ""])
        );
        for (const reference of row[index("Reference")]!.split(",")) {
            parts.set(reference, fields);
        }
    }
    return parts;
}

describe("KiCad 10 project: EEZ DIB DCP405plus", () => {
    it("lists the design variants", async () => {
        const project = await loadKicadProject(EXAMPLE_PROJECT, readGzipped);
        expect(project.name).toBe("EEZ DIB DCP405plus");
        expect(project.variants.map(v => v.name)).toEqual(["Default", "Basic"]);
        expect(project.warnings).toEqual([]);
    });

    it("gives the same Default BOM as KiCad's Symbol Fields Table export", async () => {
        const project = await loadKicadProject(EXAMPLE_PROJECT, readGzipped);
        const bom = project.variants[0]!;
        const ours = byReference(bom.table);
        const kicad = byReference(
            parseCsv(decodeText(readFileSync(BOM_CSV), "utf-8"))
        );
        // M1 is in the CSV but not in the schematics of this commit.
        kicad.delete("M1");

        expect(bom.partCount).toBe(366);
        expect(bom.table.rows).toHaveLength(124);
        expect([...ours.keys()].sort(compareReferences)).toEqual(
            [...kicad.keys()].sort(compareReferences)
        );
        for (const [reference, fields] of kicad) {
            expect({ reference, ...ours.get(reference) }).toEqual({
                reference,
                ...fields
            });
        }
    });

    it("applies the Basic variant's overrides", async () => {
        const project = await loadKicadProject(EXAMPLE_PROJECT, readGzipped);
        const basic = project.variants[1]!;
        const parts = byReference(basic.table);
        expect(basic.partCount).toBe(322);
        // R16 is DNP by default but fitted in Basic, with its own part numbers.
        expect(parts.get("R16")).toMatchObject({
            DigiKey: "311-0.0HRCT-ND",
            Mouser: "603-RC0603FR-070RL"
        });
        expect(byReference(project.variants[0]!.table).has("R16")).toBe(false);
        // ZD2 is removed in Basic.
        expect(parts.has("ZD2")).toBe(false);
        // J1 has a different connector in Basic.
        expect(parts.get("J1")).toMatchObject({
            Value: "571-0500",
            Mouser: "164-6219",
            TME: "571-0500"
        });
        // IC17's units differ only in "exclude from BOM", but all three are
        // DNP in Basic, so it's simply left out; there's nothing to warn about.
        expect(byReference(project.variants[0]!.table).has("IC17")).toBe(true);
        expect(parts.has("IC17")).toBe(false);
        expect(basic.warnings).toEqual([]);
    });
});

// --- Small synthetic projects ------------------------------------------------

const ROOT_UUID = "11111111-1111-1111-1111-111111111111";
const SHEET_A = "aaaaaaaa-0000-0000-0000-000000000000";
const SHEET_B = "bbbbbbbb-0000-0000-0000-000000000000";

function symbol(
    reference: string,
    value: string,
    instances: string,
    extra = ""
) {
    return `(symbol (lib_id "Device:R") (unit 1) (in_bom yes) (dnp no) ${extra}
        (property "Reference" "${reference}") (property "Value" "${value}")
        (property "Footprint" "R_0603") (property "Mouser" "")
        (instances (project "Test" ${instances})))`;
}

function sheet(uuid: string, file: string, extra = "") {
    return `(sheet (uuid "${uuid}") ${extra}
        (property "Sheetname" "${uuid.slice(0, 1)}") (property "Sheetfile" "${file}")
        (instances (project "Test" (path "/${ROOT_UUID}" (page "2")))))`;
}

function schematic(uuid: string, body: string, version = 20260306) {
    return `(kicad_sch (version ${version}) (generator "eeschema") (uuid "${uuid}") ${body})`;
}

function files(entries: Record<string, string>) {
    return (path: string) => {
        const name = path.replace(/^.*[\\/]/, "");
        const text = entries[name];
        return text === undefined
            ? Promise.reject(new Error(`missing ${name}`))
            : Promise.resolve(text);
    };
}

const PROJECT_JSON = JSON.stringify({
    schematic: {
        top_level_sheets: [{ filename: "test.kicad_sch", uuid: ROOT_UUID }],
        variants: [{ name: "Lite" }],
        bom_settings: {
            fields_ordered: [
                { name: "Value", group_by: true },
                { name: "Footprint", group_by: true }
            ]
        }
    }
});

describe("KiCad hierarchy", () => {
    it("gives each instance of a reused sheet its own reference", async () => {
        const project = await loadKicadProject(
            "/p/test.kicad_pro",
            files({
                "test.kicad_pro": PROJECT_JSON,
                "test.kicad_sch": schematic(
                    ROOT_UUID,
                    `${sheet(SHEET_A, "channel.kicad_sch")} ${sheet(SHEET_B, "channel.kicad_sch", "(dnp yes)")}
                     ${symbol("#PWR01", "GND", `(path "/${ROOT_UUID}" (reference "#PWR01") (unit 1))`)}`
                ),
                "channel.kicad_sch": schematic(
                    "cccccccc-0000-0000-0000-000000000000",
                    symbol(
                        "R?",
                        "10k",
                        `(path "/${ROOT_UUID}/${SHEET_A}" (reference "R1") (unit 1)
                            (variant (name "Lite") (field (name "Value") (value "22k")) (field (name "Mouser") (value "71-X"))))
                         (path "/${ROOT_UUID}/${SHEET_B}" (reference "R101") (unit 1))`
                    )
                )
            })
        );
        const [standard, lite] = project.variants;
        // Sheet B is DNP, so R101 is left out; power symbols never count.
        expect(standard!.table.rows).toEqual([["R1", "10k", "1", "R_0603"]]);
        expect(lite!.table.headers).toEqual([
            "Reference",
            "Value",
            "Qty",
            "Footprint",
            "Mouser"
        ]);
        expect(lite!.table.rows).toEqual([
            ["R1", "22k", "1", "R_0603", "71-X"]
        ]);
    });

    it("rejects schematics from KiCad 9 and older", async () => {
        const load = loadKicadProject(
            "/p/test.kicad_pro",
            files({
                "test.kicad_pro": PROJECT_JSON,
                "test.kicad_sch": schematic(ROOT_UUID, "", 20250114)
            })
        );
        await expect(load).rejects.toBeInstanceOf(KicadError);
        await expect(load).rejects.toThrow(/KiCad 10/);
    });
});

describe("S-expressions", () => {
    it("reads strings with escapes and bare atoms", () => {
        expect(parseSExpr('(a "x \\"y\\" \\\\ z" (b yes) 12.5 (c))')).toEqual([
            "a",
            'x "y" \\ z',
            ["b", "yes"],
            "12.5",
            ["c"]
        ]);
    });

    it("sorts references naturally", () => {
        expect(["R10", "C2", "R2", "C10"].sort(compareReferences)).toEqual([
            "C2",
            "C10",
            "R2",
            "R10"
        ]);
    });
});
