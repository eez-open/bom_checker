import { describe, expect, it } from "vitest";
import type { CsvTable } from "./csv-import";
import {
    applySync,
    importedKicadValues,
    joinRows,
    markWrittenToKicad,
    planJoins,
    planSync,
    readKicadBom
} from "./kicad-sync";
import type { Project } from "./model";
import {
    addCustomColumn,
    addRow,
    addSupplier,
    createProject,
    createRow
} from "./project-ops";

/** A BOM as imported from KiCad, then changed in the BOM: U1's Mouser
 *  number, a Notes column and a hand-made MECH1 row. */
function importedBom(): { project: Project; notes: string } {
    let project: Project = {
        ...addSupplier(createProject(), "mouser"),
        source: {
            kind: "kicad",
            path: "/p/board.kicad_pro",
            variant: "Default"
        }
    };
    const rows = [
        createRow({
            reference: "C1,C2,C3",
            value: "100n",
            footprint: "C_0603",
            qty: 3,
            partNumbers: { mouser: "81-A" }
        }),
        createRow({
            reference: "R1",
            value: "10k",
            footprint: "R_0603",
            qty: 1,
            partNumbers: { mouser: "71-R" }
        }),
        createRow({
            reference: "U1",
            value: "LM358",
            footprint: "SOIC-8",
            qty: 1,
            partNumbers: { mouser: "595-LM358" }
        }),
        createRow({
            reference: "R2",
            value: "1k",
            footprint: "R_0603",
            qty: 1,
            partNumbers: { mouser: "71-X" }
        })
    ];
    for (const row of rows) {
        project = addRow(project, row);
    }
    project = {
        ...project,
        source: {
            ...project.source,
            kicadValues: importedKicadValues(project)
        }
    };
    // Changes made in the BOM since the import.
    const { project: withNotes, column } = addCustomColumn(
        project,
        "Notes",
        "text"
    );
    project = {
        ...withNotes,
        rows: withNotes.rows.map(row =>
            row.reference === "U1"
                ? { ...row, partNumbers: { mouser: "595-OLD" } }
                : row.reference === "C1,C2,C3"
                  ? { ...row, custom: { [column.id]: "keep" } }
                  : row
        )
    };
    project = addRow(
        project,
        createRow({ reference: "MECH1", value: "Screw" })
    );
    return { project, notes: column.id };
}

/** KiCad now: C3 got another Mouser number, C4 and D9 were added, R1 and
 *  U1 changed, R2 was deleted. */
const KICAD: CsvTable = {
    headers: ["Reference", "Value", "Qty", "Footprint", "Mouser", "LCSC"],
    rows: [
        ["C1,C2,C4", "100n", "3", "C_0603", "81-A", ""],
        ["C3", "100n", "1", "C_0603", "81-B", ""],
        ["D9", "1N4148", "1", "SOD-123", "", "C81598"],
        ["R1", "10k", "1", "R_0603", "71-R2", ""],
        ["U1", "LM358", "1", "SOIC-8", "595-LM358-NEW", ""]
    ]
};

describe("syncing with KiCad", () => {
    it("lists what changed in KiCad, and ticks what's safe to take", () => {
        const { project } = importedBom();
        const plan = planSync(project, readKicadBom(project, KICAD));
        const summary = plan.changes.map(change => {
            switch (change.kind) {
                case "column":
                    return `column ${change.supplier} (${change.count})`;
                case "added":
                    return `added ${change.references.join(",")}: ${change.description}`;
                case "removed":
                    return `removed ${change.references.join(",")}`;
                case "changed":
                    return `${change.references.join(",")} ${change.label}: ${change.from} → ${change.to}${change.bothChanged ? " (both)" : ""}`;
            }
        });
        expect(summary).toEqual([
            "column lcsc (1)",
            "added C4: 100n · C_0603",
            "added D9: 1N4148 · SOD-123",
            "removed R2",
            "C3 Mouser: 81-A → 81-B",
            "R1 Mouser: 71-R → 71-R2",
            "U1 Mouser: 595-OLD → 595-LM358-NEW (both)"
        ]);
        // U1 changed in the BOM too: kept unless ticked.
        expect(plan.selected).toHaveLength(6);
        expect(
            plan.changes.find(c => c.id === plan.selected.at(-1))
        ).toMatchObject({ references: ["R1"] });
    });

    it("applies the ticked changes and keeps the BOM's own work", () => {
        const { project, notes } = importedBom();
        const kicad = readKicadBom(project, KICAD);
        const plan = planSync(project, kicad);
        const synced = applySync(project, kicad, plan, new Set(plan.selected));

        expect(synced.suppliers).toEqual(["mouser", "lcsc"]);
        expect(
            synced.rows.map(row => [
                row.reference,
                row.qty,
                row.value,
                row.partNumbers.mouser ?? "",
                row.partNumbers.lcsc ?? "",
                row.custom[notes] ?? ""
            ])
        ).toEqual([
            // C3 left for its own row; C4 joined its KiCad row-mates.
            ["C1,C2,C4", 3, "100n", "81-A", "", "keep"],
            ["C3", 1, "100n", "81-B", "", "keep"],
            ["R1", 1, "10k", "71-R2", "", ""],
            // Changed in both: the BOM's value stays.
            ["U1", 1, "LM358", "595-OLD", "", ""],
            // Made by hand in the BOM: untouched.
            ["MECH1", 1, "Screw", "", "", ""],
            ["D9", 1, "1N4148", "", "C81598", ""]
        ]);
        // KiCad's values are the new reference point: syncing again finds
        // nothing, and U1's BOM value, kept on purpose, isn't offered again.
        expect(planSync(synced, readKicadBom(synced, KICAD)).changes).toEqual(
            []
        );
    });

    it("offers every difference unticked without KiCad's earlier values", () => {
        const { project } = importedBom();
        const old = {
            ...project,
            source: { ...project.source, kicadValues: undefined }
        };
        const plan = planSync(old, readKicadBom(old, KICAD));
        const removed = plan.changes.filter(c => c.kind === "removed");
        // MECH1 may have been added by hand, R2 deleted in KiCad: both
        // offered, neither ticked.
        expect(removed.map(c => c.references)).toEqual([["R2"], ["MECH1"]]);
        expect(plan.changes.filter(c => c.kind === "changed")).toHaveLength(3);
        expect(plan.selected.map(id => id.split(":")[0])).toEqual([
            "column",
            "added",
            "added"
        ]);
    });

    it("finds nothing when the BOM is as imported", () => {
        const project = addRow(
            {
                ...addSupplier(createProject(), "mouser"),
                source: { kind: "kicad" }
            },
            createRow({
                reference: "C1 , C2",
                value: "100n",
                footprint: "C_0603",
                qty: 2,
                partNumbers: { mouser: "81-A" }
            })
        );
        const table: CsvTable = {
            headers: ["Reference", "Value", "Qty", "Footprint", "Mouser"],
            rows: [["C1,C2", "100n", "2", "C_0603", "81-A "]]
        };
        expect(planSync(project, readKicadBom(project, table)).changes).toEqual(
            []
        );
    });

    it("takes values written by Update KiCad as KiCad's", () => {
        const { project } = importedBom();
        // The BOM's U1 number was written to KiCad.
        const written = markWrittenToKicad(project, [
            { references: "U1", key: "pn:mouser", to: "595-OLD" }
        ]);
        const table: CsvTable = {
            ...KICAD,
            rows: KICAD.rows.map(row =>
                row[0] === "U1" ? [...row.slice(0, 4), "595-OLD", ""] : row
            )
        };
        const plan = planSync(written, readKicadBom(written, table));
        expect(
            plan.changes.filter(
                c => c.kind === "changed" && c.references.includes("U1")
            )
        ).toEqual([]);
    });

    describe("after KiCad renumbered its parts (#55)", () => {
        /** C7,C12 10n; C8,C9 100n; C13 1u, as imported, then Notes
         *  added in the BOM. */
        function renumbered(notes: Record<string, string> = {}) {
            let project: Project = {
                ...addSupplier(createProject(), "mouser"),
                source: { kind: "kicad" }
            };
            for (const [reference, value, mouser] of [
                ["C7,C12", "10n", "81-10N"],
                ["C8,C9", "100n", "81-100N"],
                ["C13", "1u", "81-1U"]
            ] as const) {
                project = addRow(
                    project,
                    createRow({
                        reference,
                        value,
                        footprint: "C_0603",
                        qty: reference.split(",").length,
                        partNumbers: { mouser }
                    })
                );
            }
            project = {
                ...project,
                source: {
                    ...project.source,
                    kicadValues: importedKicadValues(project)
                }
            };
            const { project: withNotes, column } = addCustomColumn(
                project,
                "Notes",
                "text"
            );
            project = {
                ...withNotes,
                rows: withNotes.rows.map(row =>
                    notes[row.reference]
                        ? {
                              ...row,
                              custom: { [column.id]: notes[row.reference]! }
                          }
                        : row
                )
            };
            // A 4u7 added as C7, then Annotate Schematic: every capacitor
            // from C7 on is one higher.
            const table: CsvTable = {
                headers: ["Reference", "Value", "Qty", "Footprint", "Mouser"],
                rows: [
                    ["C7", "4u7", "1", "C_0603", "81-4U7"],
                    ["C8,C13", "10n", "2", "C_0603", "81-10N"],
                    ["C9,C10", "100n", "2", "C_0603", "81-100N"],
                    ["C14", "1u", "1", "C_0603", "81-1U"]
                ]
            };
            const kicad = readKicadBom(project, table);
            const plan = planSync(project, kicad);
            const synced = applySync(
                project,
                kicad,
                plan,
                new Set(plan.selected)
            );
            return { synced, kicad, notes: column.id };
        }

        const summary = (project: Project, notes: string) =>
            project.rows.map(row =>
                [row.reference, row.qty, row.value, row.custom[notes] ?? ""]
                    .filter(value => value !== "")
                    .join(" ")
            );

        it("joins the rows KiCad has as one", () => {
            const { synced, kicad, notes } = renumbered({ C13: "check" });
            // The 10n capacitors C8 and C13 were compared with the 100n C8
            // and the 1u C13 of the BOM, so they're in two rows.
            expect(summary(synced, notes)).toEqual([
                "C7 1 4u7",
                "C8 1 10n",
                "C9,C10 2 100n",
                "C13 1 10n check",
                "C14 1 1u"
            ]);
            const joins = planJoins(synced, kicad);
            expect(joins).toMatchObject([
                {
                    references: ["C8", "C13"],
                    description: "10n · C_0603",
                    rowIds: [synced.rows[1]!.id, synced.rows[3]!.id]
                }
            ]);
            const joined = joinRows(synced, joins);
            // In the first row's place, with the Notes only one row had.
            expect(summary(joined, notes)).toEqual([
                "C7 1 4u7",
                "C8,C13 2 10n check",
                "C9,C10 2 100n",
                "C14 1 1u"
            ]);
            expect(joined.rows[1]!.id).toBe(synced.rows[1]!.id);
            expect(planSync(joined, kicad).changes).toEqual([]);
            expect(planJoins(joined, kicad)).toEqual([]);
            // The same rows get the same id, whatever their row ids.
            expect(planJoins(renumbered().synced, kicad)[0]?.id).toBe(
                joins[0]!.id
            );
        });

        it("keeps rows apart that differ in other columns", () => {
            const { synced, kicad } = renumbered({
                "C8,C9": "this",
                C13: "that"
            });
            expect(planJoins(synced, kicad)).toEqual([]);
        });

        it("keeps rows apart that KiCad doesn't have in one row", () => {
            const { synced, kicad } = renumbered();
            // C14 as a 10n too, but in a KiCad row of its own.
            const moved = {
                ...synced,
                rows: synced.rows.map(row =>
                    row.reference === "C14"
                        ? {
                              ...row,
                              value: "10n",
                              partNumbers: { mouser: "81-10N" }
                          }
                        : row
                )
            };
            expect(
                planJoins(moved, kicad).map(join => join.references)
            ).toEqual([["C8", "C13"]]);
        });
    });
});
