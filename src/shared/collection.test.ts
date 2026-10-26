import { describe, expect, it } from "vitest";
import { partNumbersToCollect, summarizeRun, supplierWork } from "./collection";
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
            remaining: 0
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
