import { describe, expect, it } from "vitest";
import {
    componentKey,
    fileTitle,
    mergeCollected,
    withNewerResults
} from "./bom-list";
import {
    BomListFileError,
    parseBomListFile,
    serializeBomList
} from "./bom-list-file";
import type { LookupResult, Project } from "./model";
import {
    addToHistory,
    createHistoryProject,
    USED_IN_COLUMN
} from "./parts-history";
import { addRow, createProject, createRow } from "./project-ops";

function notFound(fetchedAt: string): LookupResult {
    return { status: "notFound", runId: "r", fetchedAt };
}

function bom(
    rows: [string, string, Record<string, string>][],
    results: Project["collected"]["results"] = {}
): Project {
    const project = rows.reduce(
        (bom, [value, footprint, partNumbers]) =>
            addRow(bom, createRow({ value, footprint, partNumbers })),
        createProject()
    );
    return { ...project, collected: { results, runs: {} } };
}

function usedIn(history: Project): (string | number | undefined)[] {
    const column = history.customColumns.find(c => c.name === USED_IN_COLUMN)!;
    return history.rows.map(row => row.custom[column.id]);
}

describe("BOM list file", () => {
    it("round-trips a list, with how many of each BOM a device has", () => {
        const list = {
            schemaVersion: 2 as const,
            boms: [
                { path: "psu/psu.eezbom", perDevice: 2 },
                { path: "mcu.eezbom", perDevice: 1 }
            ],
            history: "parts history.eezbom",
            buildQuantity: 25
        };
        expect(parseBomListFile(serializeBomList(list))).toEqual(list);
    });

    it("reads format 1: one of each BOM, one device (#39)", () => {
        expect(
            parseBomListFile(
                JSON.stringify({
                    schemaVersion: 1,
                    boms: ["a.eezbom", "b.eezbom"],
                    history: null
                })
            )
        ).toEqual({
            schemaVersion: 2,
            boms: [
                { path: "a.eezbom", perDevice: 1 },
                { path: "b.eezbom", perDevice: 1 }
            ],
            history: null,
            buildQuantity: 1
        });
    });

    it("rejects other files and newer formats", () => {
        expect(() => parseBomListFile("{")).toThrow(BomListFileError);
        expect(() =>
            parseBomListFile(JSON.stringify({ schemaVersion: 1, boms: [1] }))
        ).toThrow(/damaged/);
        expect(() =>
            parseBomListFile(
                JSON.stringify({
                    schemaVersion: 2,
                    boms: [{ path: "a.eezbom", perDevice: 0 }],
                    history: null,
                    buildQuantity: 1
                })
            )
        ).toThrow(/damaged/);
        expect(() =>
            parseBomListFile(JSON.stringify({ schemaVersion: 3 }))
        ).toThrow(/newer version/);
    });

    it("names files without the extension", () => {
        expect(fileTitle("C:\\work\\psu\\PSU board.eezbom")).toBe("PSU board");
        expect(fileTitle("/home/me/device.eezbom-list")).toBe("device");
    });
});

describe("components of a list", () => {
    it("are the same with equal Value and Footprint", () => {
        const key = (value: string, footprint: string, match = true) =>
            componentKey({ value, footprint }, match);
        expect(key(" 10k ", "R_0603")).toBe(key("10k", "R_0603 "));
        expect(key("10k", "R_0603")).not.toBe(key("10k", "R_0805"));
        expect(key("10k", "R_0603", false)).toBe(key("10k", "R_0805", false));
        expect(key("10k", "R_0603")).toBe(key("10K", "r_0603"));
        expect(key("10m", "")).not.toBe(key("10M", ""));
    });

    it("merge collected data, the newest result winning", () => {
        const older = bom([], {
            mouser: { A: notFound("2026-01-01"), B: notFound("2026-03-01") }
        });
        const newer = bom([], { mouser: { A: notFound("2026-02-01") } });
        const merged = mergeCollected([older, newer]);
        expect(merged.results.mouser?.A?.fetchedAt).toBe("2026-02-01");
        expect(merged.results.mouser?.B?.fetchedAt).toBe("2026-03-01");

        const target = bom([], { mouser: { A: notFound("2026-01-15") } });
        const updated = withNewerResults(target, merged, {
            mouser: ["a", "C"]
        });
        expect(updated.collected.results.mouser?.A?.fetchedAt).toBe(
            "2026-02-01"
        );
        expect(updated.collected.results.mouser?.C).toBeUndefined();
        expect(withNewerResults(updated, merged, { mouser: ["A"] })).toBe(
            updated
        );
    });
});

describe("parts history", () => {
    it("adds combinations it doesn't have yet", () => {
        const psu = bom([
            ["10k", "R_0603", { digikey: "D-1", mouser: "M-1" }],
            ["10k", "R_0603", { digikey: "D-1" }], // covered by the first
            ["100n", "C_0603", {}], // no part number
            ["LM358", "SOIC-8", { mouser: "-" }] // "-" isn't one
        ]);
        const first = addToHistory(createHistoryProject(), [
            { name: "psu", project: psu }
        ]);
        expect(first.added).toBe(1);
        expect(first.project.suppliers).toEqual(["digikey", "mouser"]);
        expect(usedIn(first.project)).toEqual(["psu"]);

        const mcu = bom([
            ["10k", "R_0603", { digikey: "D-1" }], // known
            ["10k", "R_0603", { digikey: "D-2" }], // another part number
            ["10k", "R_0805", { digikey: "D-1" }] // another footprint
        ]);
        const second = addToHistory(first.project, [
            { name: "mcu", project: mcu }
        ]);
        expect(second.added).toBe(2);
        expect(
            second.project.rows.map(row => [
                row.value,
                row.footprint,
                row.partNumbers.digikey
            ])
        ).toEqual([
            ["10k", "R_0603", "D-1"],
            ["10k", "R_0603", "D-2"],
            ["10k", "R_0805", "D-1"]
        ]);
        expect(usedIn(second.project)).toEqual(["psu, mcu", "mcu", "mcu"]);
    });

    it("stays the same object when nothing is new", () => {
        const psu = bom([["10k", "R_0603", { digikey: "D-1" }]]);
        const { project } = addToHistory(createHistoryProject(), [
            { name: "psu", project: psu }
        ]);
        expect(addToHistory(project, [{ name: "psu", project: psu }])).toEqual({
            project,
            added: 0
        });
    });

    it("keeps the newest collected data of its part numbers", () => {
        const psu = bom([["10k", "R_0603", { digikey: "D-1" }]], {
            digikey: {
                "D-1": notFound("2026-05-01"),
                X: notFound("2026-05-01")
            }
        });
        const { project } = addToHistory(createHistoryProject(), [
            { name: "psu", project: psu }
        ]);
        expect(Object.keys(project.collected.results.digikey ?? {})).toEqual([
            "D-1"
        ]);
    });
});
