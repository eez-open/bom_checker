import { describe, expect, it } from "vitest";
import {
    collectedKeysOf,
    formatDateTime,
    lastCollectedAt,
    partNumbersToCollect,
    summarizeRun,
    supplierWork,
    valueMatches,
    withoutExpired,
    withoutResults
} from "./collection";
import { digikeyLifecycle, mouserLifecycle, tmeLifecycle } from "./lifecycle";
import type { LookupResult, Project, SupplierOffer } from "./model";
import { addRow, createProject, createRow } from "./project-ops";

const AT = "2026-10-26T10:00:00Z";

function offer(stockQty: number): SupplierOffer {
    return {
        supplierPartNumber: "x",
        manufacturer: "m",
        manufacturerPartNumber: "x",
        description: "",
        stockQty,
        moq: 1,
        orderMultiple: 1,
        priceBreaks: [],
        priceKind: "unknown",
        currency: "EUR",
        lifecycle: "active",
        lifecycleRaw: null,
        rohs: null
    };
}

/** Rows with these Mouser part numbers and quantities. */
function bom(cells: [string, number][]): Project {
    return cells.reduce(
        (project, [mouser, qty]) =>
            addRow(project, createRow({ qty, partNumbers: { mouser } })),
        { ...createProject(), suppliers: ["mouser"] } as Project
    );
}

function withResults(
    project: Project,
    results: Record<string, LookupResult>,
    run?: Project["collected"]["runs"]["mouser"]
): Project {
    return {
        ...project,
        collected: {
            results: { mouser: results },
            runs: run ? { mouser: run } : {}
        }
    };
}

describe("collection work", () => {
    const project = bom([
        ["A-1", 2],
        [" a-1 ", 3], // same part number, other case and spaces
        ["B-2", 1],
        ["-", 1],
        ["", 1],
        ["C-3 or C-4", 1]
    ]);

    it("counts distinct part numbers and flagged cells", () => {
        expect(supplierWork(project, "mouser")).toEqual({
            total: 2,
            flagged: 1,
            missing: 2,
            remaining: 0,
            valueRows: 0
        });
        expect(partNumbersToCollect(project, "mouser", "all")).toEqual([
            "A-1",
            "B-2"
        ]);
        expect(partNumbersToCollect(project, "digikey", "all")).toEqual([]);
    });

    it("continues an interrupted run where it stopped", () => {
        const interrupted = withResults(
            project,
            { "A-1": { status: "notFound", runId: "r2", fetchedAt: AT } },
            { id: "r2", startedAt: AT, state: "interrupted" }
        );
        expect(supplierWork(interrupted, "mouser")).toMatchObject({
            missing: 1,
            remaining: 1
        });
        expect(partNumbersToCollect(interrupted, "mouser", "continue")).toEqual(
            ["B-2"]
        );
        expect(partNumbersToCollect(interrupted, "mouser", "missing")).toEqual([
            "B-2"
        ]);
    });

    it("counts results from older runs as collected but not continued", () => {
        const older = withResults(
            project,
            {
                "A-1": { status: "notFound", runId: "r1", fetchedAt: AT },
                "B-2": { status: "notFound", runId: "r2", fetchedAt: AT }
            },
            { id: "r2", startedAt: AT, state: "interrupted" }
        );
        expect(partNumbersToCollect(older, "mouser", "missing")).toEqual([]);
        expect(partNumbersToCollect(older, "mouser", "continue")).toEqual([
            "A-1"
        ]);
    });

    it("tries part numbers again that only have an error", () => {
        const failed = withResults(project, {
            "A-1": {
                status: "error",
                message: "HTTP 500",
                runId: "r1",
                fetchedAt: AT
            },
            "B-2": { status: "notFound", runId: "r1", fetchedAt: AT }
        });
        expect(supplierWork(failed, "mouser").missing).toBe(1);
        expect(partNumbersToCollect(failed, "mouser", "missing")).toEqual([
            "A-1"
        ]);
    });

    it("collects only the selected rows (#17)", () => {
        const [, second, third] = project.rows;
        const rowIds = new Set([second!.id, third!.id]);
        expect(supplierWork(project, "mouser", { rowIds })).toMatchObject({
            total: 2,
            missing: 2
        });
        expect(
            partNumbersToCollect(project, "mouser", "all", {
                rowIds: new Set([second!.id])
            })
        ).toEqual(["a-1"]);
    });
});

describe("run summary", () => {
    it("counts outcomes and stock against the BOM quantity", () => {
        const project = withResults(
            bom([
                ["A-1", 2],
                ["A-1", 3],
                ["B-2", 10],
                ["C-3", 1],
                ["D-4", 1]
            ]),
            {
                "A-1": {
                    status: "found",
                    runId: "r1",
                    fetchedAt: AT,
                    matchedBy: "supplierPartNumber",
                    offer: offer(5)
                },
                "B-2": {
                    status: "found",
                    runId: "r1",
                    fetchedAt: AT,
                    matchedBy: "mpn",
                    offer: offer(9)
                },
                "C-3": { status: "notFound", runId: "r1", fetchedAt: AT },
                "D-4": {
                    status: "error",
                    message: "x",
                    runId: "r0",
                    fetchedAt: AT
                }
            }
        );
        expect(summarizeRun(project, "mouser", "r1")).toEqual({
            requested: 3,
            found: 2,
            notFound: 1,
            ambiguous: 0,
            errors: 0,
            inStock: 1,
            notInStock: 1
        });
    });
});

describe("lifecycle", () => {
    it("maps DigiKey, Mouser and TME statuses", () => {
        expect(digikeyLifecycle("Active")).toBe("active");
        expect(digikeyLifecycle("Not For New Designs")).toBe("nrnd");
        expect(digikeyLifecycle("Discontinued at Digi-Key")).toBe("obsolete");
        expect(digikeyLifecycle("Something new")).toBeNull();
        expect(mouserLifecycle(null, false)).toBe("active");
        expect(mouserLifecycle("End of Life", false)).toBe("eol");
        expect(mouserLifecycle(null, true)).toBe("obsolete");
        expect(tmeLifecycle([])).toBe("active");
        expect(tmeLifecycle(["NEW", "AVAILABLE_WHILE_STOCKS_LAST"])).toBe(
            "eol"
        );
        expect(tmeLifecycle(["DANGEROUS", "OVERSIZED"])).toBe("active");
    });
});

describe("collection time", () => {
    it("is the end of the latest run or the newest result", () => {
        const result = (fetchedAt: string): LookupResult => ({
            status: "notFound",
            runId: "r1",
            fetchedAt
        });
        expect(
            lastCollectedAt(
                {
                    results: {
                        mouser: {
                            A: result("2026-10-20T08:00:00.000Z"),
                            B: result("2026-10-26T09:00:00.000Z")
                        }
                    },
                    runs: {
                        mouser: {
                            id: "r1",
                            startedAt: "2026-10-26T08:59:00.000Z",
                            endedAt: "2026-10-26T09:01:00.000Z",
                            state: "complete"
                        }
                    }
                },
                "mouser"
            )
        ).toBe("2026-10-26T09:01:00.000Z");
        expect(
            lastCollectedAt(
                {
                    results: { tme: { A: result("2026-10-20T08:00:00.000Z") } },
                    runs: {}
                },
                "tme"
            )
        ).toBe("2026-10-20T08:00:00.000Z");
        expect(
            lastCollectedAt({ results: {}, runs: {} }, "digikey")
        ).toBeNull();
    });

    it("is shown as local date and time", () => {
        const local = new Date(2026, 9, 6, 7, 5, 30);
        expect(formatDateTime(local.toISOString())).toBe("2026-10-06 07:05");
        expect(formatDateTime("garbage")).toBe("garbage");
    });
});

describe("looking up Values", () => {
    const rows: [string, string | undefined][] = [
        ["TPS54331DDA", undefined], // empty cell: looked up
        ["LM358", "-"], // no such part at Mouser
        ["100n", undefined], // generic value
        ["NE555", "595-NE555P"], // has a part number
        ["1N4007", undefined],
        ["BAV99", undefined]
    ];
    const project = rows.reduce(
        (bom, [value, mouser]) =>
            addRow(
                bom,
                createRow({
                    value,
                    partNumbers: mouser === undefined ? {} : { mouser }
                })
            ),
        { ...createProject(), suppliers: ["mouser"] } as Project
    );

    it("adds Values of rows without a part number when asked", () => {
        expect(partNumbersToCollect(project, "mouser", "all")).toEqual([
            "595-NE555P"
        ]);
        expect(
            partNumbersToCollect(project, "mouser", "all", { byValue: true })
        ).toEqual(["595-NE555P", "TPS54331DDA", "1N4007", "BAV99"]);
        expect(
            supplierWork(project, "mouser", { byValue: true })
        ).toMatchObject({ total: 4, missing: 4, valueRows: 3 });
        // Counted with the option off too, to point to it.
        expect(supplierWork(project, "mouser")).toMatchObject({
            total: 1,
            valueRows: 3
        });
    });

    it("fills the supplier's part number, or the Value to choose from", () => {
        const found = (supplierPartNumber: string): LookupResult => ({
            status: "found",
            offer: { ...offer(10), supplierPartNumber },
            matchedBy: "mpn",
            runId: "r1",
            fetchedAt: AT
        });
        const collected = withResults(project, {
            TPS54331DDA: found("595-TPS54331DDA"),
            "1N4007": {
                status: "ambiguous",
                candidates: [offer(1), offer(2)],
                runId: "r1",
                fetchedAt: AT
            },
            BAV99: { status: "notFound", runId: "r1", fetchedAt: AT }
        });
        const matches = valueMatches(collected, "mouser");
        expect(
            matches.cells.map(cell => [
                collected.rows.find(row => row.id === cell.rowId)?.value,
                cell.partNumber
            ])
        ).toEqual([
            ["TPS54331DDA", "595-TPS54331DDA"],
            ["1N4007", "1N4007"]
        ]);
        expect(matches).toMatchObject({ found: 1, ambiguous: 1, notFound: 1 });
        // Only the rows asked for.
        const first = new Set([collected.rows[0]!.id]);
        expect(valueMatches(collected, "mouser", first)).toMatchObject({
            found: 1,
            ambiguous: 0,
            notFound: 0
        });
    });
});

describe("forgetting the data of rows (#40)", () => {
    const result = (fetchedAt = AT): LookupResult => ({
        status: "notFound",
        runId: "r1",
        fetchedAt
    });
    const project = withResults(
        [
            createRow({ value: "TPS54331DDA" }), // looked up by Value
            createRow({ value: "10k", partNumbers: { mouser: " a-1 " } }),
            createRow({ value: "100n", partNumbers: { mouser: "B-2" } }),
            createRow({ value: "1u", partNumbers: { mouser: "A-1" } })
        ].reduce(addRow, { ...createProject(), suppliers: ["mouser"] }),
        {
            TPS54331DDA: result(),
            "A-1": result(),
            "B-2": result()
        }
    );
    const ids = (...indexes: number[]) =>
        new Set(indexes.map(index => project.rows[index]!.id));

    it("finds the results of the rows' part numbers and Values", () => {
        const { keys, rows } = collectedKeysOf(project, ids(0, 1));
        expect(rows).toBe(2);
        expect(keys).toEqual({ mouser: new Set(["TPS54331DDA", "A-1"]) });
        expect(collectedKeysOf(project, new Set())).toEqual({
            keys: {},
            rows: 0
        });
    });

    it("removes them, also for other rows with the same part numbers", () => {
        const { keys } = collectedKeysOf(project, ids(1));
        const collected = withoutResults(project.collected, keys);
        expect(Object.keys(collected.results.mouser!)).toEqual([
            "TPS54331DDA",
            "B-2"
        ]);
        // Row 3 has the same part number as row 1.
        expect(collectedKeysOf({ ...project, collected }, ids(3)).rows).toBe(0);
        expect(withoutResults(collected, keys)).toBe(collected);
    });
});

describe("expired supplier data (#62)", () => {
    it("drops Arrow's results older than 48 hours, keeps the others", () => {
        const at = (fetchedAt: string): LookupResult => ({
            status: "notFound",
            runId: "r",
            fetchedAt
        });
        const now = Date.parse("2026-11-07T12:00:00Z");
        const collected = {
            results: {
                "arrow-europe": {
                    OLD: at("2026-11-05T11:59:00Z"),
                    NEW: at("2026-11-05T12:01:00Z")
                },
                mouser: { OLD: at("2026-01-01T00:00:00Z") }
            },
            runs: {}
        };
        expect(withoutExpired(collected, now).results).toEqual({
            "arrow-europe": { NEW: at("2026-11-05T12:01:00Z") },
            mouser: { OLD: at("2026-01-01T00:00:00Z") }
        });
        const fresh = withoutExpired(collected, now);
        expect(withoutExpired(fresh, now)).toBe(fresh);
    });
});
