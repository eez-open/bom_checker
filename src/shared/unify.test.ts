import { describe, expect, it } from "vitest";
import type { ListMember } from "./bom-list";
import type { CollectedData, LookupResult, Project } from "./model";
import { addRow, createProject, createRow } from "./project-ops";
import {
    applyDecisions,
    findHistoryGroups,
    findUnifyGroups,
    suggestDecision,
    type UnifyDecision
} from "./unify";

/** Rows of [reference, value, footprint, qty, part numbers]. */
function member(
    name: string,
    rows: [string, string, string, number, Record<string, string>][],
    perDevice = 1
): ListMember {
    const project = rows.reduce(
        (bom, [reference, value, footprint, qty, partNumbers]) =>
            addRow(
                bom,
                createRow({ reference, value, footprint, qty, partNumbers })
            ),
        {
            ...createProject(),
            suppliers: ["digikey", "mouser"],
            // Doesn't count in a list (#39).
            buildQuantity: 7
        } as Project
    );
    return { path: `${name}.eezbom`, name, project, perDevice };
}

function found(
    supplierPartNumber: string,
    stockQty: number,
    unitPrice: number
): LookupResult {
    return {
        status: "found",
        matchedBy: "supplierPartNumber",
        runId: "r",
        fetchedAt: "2026-10-28",
        offer: {
            supplierPartNumber,
            manufacturer: "",
            manufacturerPartNumber: "",
            description: "",
            stockQty,
            moq: 1,
            orderMultiple: 1,
            priceBreaks: [{ qty: 1, unitPrice }],
            priceKind: "list",
            currency: "EUR",
            lifecycle: "active",
            lifecycleRaw: null,
            rohs: null
        }
    };
}

const psu = member(
    "psu",
    [
        ["R1, R2", "10k", "R_0603", 2, { digikey: "D-1" }],
        ["R3", "10k", "R_0805", 1, { digikey: "D-9" }],
        ["U1", "LM358", "SOIC-8", 1, { digikey: "U-1" }]
    ],
    5
);
const mcu = member("mcu", [
    ["R1", "10k", "R_0603", 1, { digikey: "D-2", mouser: "M-1" }],
    ["R4", "10K", "R_0603", 3, { digikey: "d-1", mouser: "M-1" }],
    ["U1", "LM358", "SOIC-8", 1, { digikey: "U-1" }]
]);

describe("unifying part numbers", () => {
    it("finds components with different part numbers", () => {
        const groups = findUnifyGroups([psu, mcu], null, { buildQuantity: 2 });
        // LM358 has the same part number everywhere; 0805 is another part.
        expect(groups).toHaveLength(1);
        const [group] = groups;
        // "10K" joins through the shared part number D-1.
        expect(group!.values).toEqual(["10k", "10K"]);
        expect(group!.rows.map(row => row.reference)).toEqual([
            "R1, R2",
            "R1",
            "R4"
        ]);
        // For 2 devices with 5 psu each: (2 × 5 + 1 + 3) × 2.
        expect(group!.totalQty).toBe(28);
        expect(group!.suppliers.digikey).toEqual([
            { partNumber: "D-1", rows: 2, usedIn: ["psu", "mcu"] },
            { partNumber: "D-2", rows: 1, usedIn: ["mcu"] }
        ]);
        // Mouser: empty in psu.
        expect(group!.suppliers.mouser).toEqual([
            { partNumber: "M-1", rows: 2, usedIn: ["mcu"] }
        ]);
    });

    it("ignores footprints when asked", () => {
        const groups = findUnifyGroups([psu, mcu], null, {
            matchFootprint: false
        });
        expect(groups[0]!.suppliers.digikey?.map(c => c.partNumber)).toEqual([
            "D-1",
            "D-9",
            "D-2"
        ]);
    });

    it("offers the history's part numbers too", () => {
        const history = member("history", [
            ["", "10k", "R_0603", 1, { digikey: "D-7" }],
            ["", "10k", "R_0603", 1, { digikey: "D-2" }]
        ]).project;
        const [group] = findUnifyGroups([psu, mcu], history);
        expect(group!.suppliers.digikey).toEqual([
            { partNumber: "D-1", rows: 2, usedIn: ["psu", "mcu"] },
            { partNumber: "D-2", rows: 1, usedIn: ["mcu", "history"] },
            { partNumber: "D-7", rows: 0, usedIn: ["history"] }
        ]);
    });

    it("suggests the cheapest in stock, else the most used", () => {
        const [group] = findUnifyGroups([psu, mcu], null);
        const collected: CollectedData = {
            results: {
                digikey: {
                    "D-1": found("D-1", 1000, 0.1),
                    "D-2": found("D-2", 1000, 0.05)
                },
                // M-1 has too little stock for 24.
                mouser: { "M-1": found("M-1", 10, 0.01) }
            },
            runs: {}
        };
        expect(suggestDecision(group!, collected)).toEqual({
            value: "10k",
            suppliers: { digikey: "D-2", mouser: "M-1" }
        });
        expect(
            suggestDecision(group!, { results: {}, runs: {} }).suppliers
        ).toEqual({ digikey: "D-1", mouser: "M-1" });
        // Not found: D-2 instead; nothing else for Mouser, so keep.
        const notFound: LookupResult = {
            status: "notFound",
            runId: "r",
            fetchedAt: "2026-10-28"
        };
        expect(
            suggestDecision(group!, {
                results: {
                    digikey: { "D-1": notFound },
                    mouser: { "M-1": notFound }
                },
                runs: {}
            }).suppliers
        ).toEqual({ digikey: "D-2", mouser: null });
    });

    it("applies the choices to the BOMs' rows", () => {
        const [group] = findUnifyGroups([psu, mcu], null);
        const decision: UnifyDecision = {
            value: "10k",
            suppliers: { digikey: "D-1", mouser: null }
        };
        const { projects, rows } = applyDecisions(
            [psu, mcu],
            [group!],
            new Map([[group!.id, decision]])
        );
        // psu's R1, R2 has D-1 already.
        expect([...rows]).toEqual([["mcu.eezbom", 2]]);
        expect(
            projects
                .get("mcu.eezbom")!
                .rows.map(row => [
                    row.value,
                    row.partNumbers.digikey,
                    row.partNumbers.mouser
                ])
        ).toEqual([
            ["10k", "D-1", "M-1"],
            ["10k", "D-1", "M-1"], // "d-1" written as chosen
            ["LM358", "U-1", undefined]
        ]);
    });
});

describe("checking the history (#52)", () => {
    // 10k at DigiKey: D-1 now, D-0 used before; 1u and 100n: nothing else.
    const board = member("board", [
        ["R1, R2", "10k", "R_0603", 2, { digikey: "D-1" }],
        ["C1", "1u", "C_0603", 1, { digikey: "D-5" }],
        ["C2", "100n", "C_0603", 1, {}]
    ]);
    const history = member("history", [
        ["", "10k", "R_0603", 1, { digikey: "D-0" }],
        ["", "10k", "R_0603", 1, { digikey: "d-1", mouser: "M-1" }],
        ["", "1u", "C_0603", 1, { digikey: "D-5" }],
        ["", "100n", "C_0603", 1, { digikey: "D-7" }],
        ["", "10k", "R_0805", 1, { digikey: "D-8" }]
    ]).project;

    it("offers the part numbers the history has for the rows", () => {
        const groups = findHistoryGroups(board, null, history, {
            buildQuantity: 10
        });
        expect(
            groups.map(group => ({
                row: group.rows[0]!.reference,
                qty: group.totalQty,
                digikey: group.suppliers.digikey?.map(c => [
                    c.partNumber,
                    c.usedIn.join("+")
                ]),
                mouser: group.suppliers.mouser?.map(c => c.partNumber)
            }))
        ).toEqual([
            // The other footprint's D-8 isn't offered; Mouser's M-1 is.
            {
                row: "R1, R2",
                qty: 20,
                digikey: [
                    ["D-1", "board+history"],
                    ["D-0", "history"]
                ],
                mouser: ["M-1"]
            },
            // An empty cell can be filled in.
            {
                row: "C2",
                qty: 10,
                digikey: [["D-7", "history"]],
                mouser: undefined
            }
        ]);
        // Only the rows asked for.
        const c1 = board.project.rows[1]!.id;
        expect(findHistoryGroups(board, new Set([c1]), history)).toEqual([]);
    });

    it("suggests a history part number in stock that costs less", () => {
        const [group] = findHistoryGroups(board, null, history, {
            buildQuantity: 10
        });
        const collected: CollectedData = {
            results: {
                digikey: {
                    "D-1": found("D-1", 1000, 0.1),
                    "D-0": found("D-0", 50, 0.05)
                }
            },
            runs: {}
        };
        expect(suggestDecision(group!, collected).suppliers.digikey).toBe(
            "D-0"
        );
        // Not enough in stock: keep D-1.
        const short: CollectedData = {
            ...collected,
            results: {
                digikey: {
                    ...collected.results.digikey,
                    "D-0": found("D-0", 5, 0.05)
                }
            }
        };
        expect(suggestDecision(group!, short).suppliers.digikey).toBe("D-1");
        const changes = applyDecisions(
            [board],
            [group!],
            new Map([
                [group!.id, { value: null, suppliers: { digikey: "D-0" } }]
            ])
        );
        expect(changes.projects.get(board.path)!.rows[0]!.partNumbers).toEqual({
            digikey: "D-0"
        });
    });
});
