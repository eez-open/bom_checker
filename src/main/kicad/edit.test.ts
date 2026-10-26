import { describe, expect, it } from "vitest";
import { editFields, kicadString, parseNodes } from "./edit";
import { parseSchematic } from "./schematic";

// A symbol as KiCad 10 writes it, trimmed to what matters here.
const SCHEMATIC = `(kicad_sch
\t(version 20260306)
\t(generator "eeschema")
\t(uuid "root-uuid")
\t(symbol
\t\t(lib_id "Device:R")
\t\t(at 100 50 0)
\t\t(dnp no)
\t\t(uuid "sym-1")
\t\t(property "Reference" "R1"
\t\t\t(at 100 48 0)
\t\t\t(effects
\t\t\t\t(font
\t\t\t\t\t(size 1.27 1.27)
\t\t\t\t)
\t\t\t)
\t\t)
\t\t(property "Footprint" "Resistor_SMD:R_0603"
\t\t\t(at 100 50 0)
\t\t\t(hide yes)
\t\t\t(effects
\t\t\t\t(font
\t\t\t\t\t(size 1.27 1.27)
\t\t\t\t)
\t\t\t)
\t\t)
\t\t(property "Mouser" "71-OLD"
\t\t\t(at 100 50 0)
\t\t\t(hide yes)
\t\t\t(effects
\t\t\t\t(font
\t\t\t\t\t(size 0.889 0.889)
\t\t\t\t)
\t\t\t)
\t\t)
\t\t(instances
\t\t\t(project "Board"
\t\t\t\t(path "/root-uuid"
\t\t\t\t\t(reference "R1")
\t\t\t\t\t(unit 1)
\t\t\t\t\t(variant
\t\t\t\t\t\t(name "Basic")
\t\t\t\t\t\t(field
\t\t\t\t\t\t\t(name "Mouser")
\t\t\t\t\t\t\t(value "71-BASIC")
\t\t\t\t\t\t)
\t\t\t\t\t)
\t\t\t\t)
\t\t\t)
\t\t)
\t)
)
`;

describe("editing a schematic", () => {
    it("keeps where each part of the file is", () => {
        const root = parseNodes(SCHEMATIC);
        expect(SCHEMATIC.slice(root.start, root.end)).toBe(SCHEMATIC.trim());
    });

    it("replaces only the value", () => {
        const edited = editFields(SCHEMATIC, [
            {
                target: { kind: "property", symbol: "sym-1", field: "Mouser" },
                value: "71-NEW"
            }
        ]);
        expect(edited).toBe(
            SCHEMATIC.replace('"Mouser" "71-OLD"', '"Mouser" "71-NEW"')
        );
    });

    it("changes a variant's own value", () => {
        const edited = editFields(SCHEMATIC, [
            {
                target: {
                    kind: "variant",
                    symbol: "sym-1",
                    path: "/root-uuid",
                    variant: "Basic",
                    field: "Mouser"
                },
                value: "71-B2"
            }
        ]);
        expect(edited).toBe(
            SCHEMATIC.replace('(value "71-BASIC")', '(value "71-B2")')
        );
    });

    it("adds a missing field as a hidden copy of Footprint", () => {
        const edited = editFields(SCHEMATIC, [
            {
                target: { kind: "property", symbol: "sym-1", field: "LCSC" },
                value: 'C25804 "x"'
            },
            {
                target: { kind: "property", symbol: "sym-1", field: "TME" },
                value: "RC0603"
            }
        ]);
        const symbol = parseSchematic(edited).symbols[0]!;
        expect(symbol.properties).toMatchObject({
            Mouser: "71-OLD",
            LCSC: 'C25804 "x"',
            TME: "RC0603"
        });
        expect(edited).toContain(
            '\t\t(property "LCSC" "C25804 \\"x\\""\n\t\t\t(at 100 50 0)\n\t\t\t(hide yes)'
        );
        // Added after the last field, in order.
        expect(edited.indexOf('"LCSC"')).toBeGreaterThan(
            edited.indexOf('"Mouser"')
        );
        expect(edited.indexOf('"TME"')).toBeGreaterThan(
            edited.indexOf('"LCSC"')
        );
    });

    it("keeps Windows line endings", () => {
        const windows = SCHEMATIC.replace(/\n/g, "\r\n");
        const edited = editFields(windows, [
            {
                target: { kind: "property", symbol: "sym-1", field: "LCSC" },
                value: "C1"
            }
        ]);
        expect(edited.replace(/\r\n/g, "")).not.toContain("\n");
    });

    it("refuses a symbol that isn't there", () => {
        expect(() =>
            editFields(SCHEMATIC, [
                {
                    target: { kind: "property", symbol: "nope", field: "X" },
                    value: ""
                }
            ])
        ).toThrow(/missing/);
    });

    it("escapes strings like KiCad", () => {
        expect(kicadString('a "b" \\ c\nd')).toBe('"a \\"b\\" \\\\ c\\nd"');
    });
});
