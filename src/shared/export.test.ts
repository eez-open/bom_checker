import { describe, expect, it } from "vitest";
import { formatDateTime } from "./collection";
import {
    buildBomSheet,
    buildInfoSheet,
    builtInPresets,
    type ExportSelection
} from "./export";
import type { LookupResult, Project, SupplierOffer } from "./model";
import {
    addCustomColumn,
    addRow,
    createProject,
    createRow
} from "./project-ops";

const AT = "2026-10-26T10:00:00Z";

function found(fields: Partial<SupplierOffer>): LookupResult {
    return {
        status: "found",
        matchedBy: "supplierPartNumber",
        runId: "r1",
        fetchedAt: AT,
        offer: {
            supplierPartNumber: "X",
            manufacturer: "Yageo",
            manufacturerPartNumber: "X",
            description: "",
            stockQty: 1000,
            moq: 1,
            orderMultiple: 1,
            priceBreaks: [{ qty: 1, unitPrice: 1 }],
            priceKind: "list",
            currency: "EUR",
            lifecycle: "active",
            lifecycleRaw: null,
            rohs: "RoHS Compliant",
            ...fields
        }
    };
}

/** The scope's example (C1) plus a Mouser-only row and a row nobody has. */
function sampleProject(): Project {
    const added = addCustomColumn(createProject(), "Notes", "text");
    let project = added.project;
    project = addRow(
        project,
        createRow({
            reference: "C1",
            value: "100n",
            qty: 20,
            partNumbers: { digikey: "DK-1", mouser: "M-1" },
            custom: { [added.column.id]: "check" }
        })
    );
    project = addRow(
        project,
        createRow({
            reference: "U1",
            value: "TPS",
            qty: 3,
            partNumbers: { mouser: "M-2" }
        })
    );
    project = addRow(
        project,
        createRow({
            reference: "J1",
            value: "Conn",
            qty: 1,
            partNumbers: { mouser: "M-3" }
        })
    );
    return {
        ...project,
        suppliers: ["digikey", "mouser"],
        collected: {
            results: {
                digikey: {
                    "DK-1": found({ priceBreaks: [{ qty: 1, unitPrice: 1.2 }] })
                },
                mouser: {
                    "M-1": found({
                        stockQty: 10,
                        priceBreaks: [{ qty: 1, unitPrice: 1 }]
                    }),
                    "M-2": found({
                        moq: 10,
                        priceBreaks: [{ qty: 1, unitPrice: 2.1 }]
                    }),
                    "M-3": { status: "notFound", runId: "r1", fetchedAt: AT }
                }
            },
            runs: {
                mouser: {
                    id: "r1",
                    startedAt: AT,
                    endedAt: AT,
                    state: "complete"
                }
            }
        }
    };
}

const PREFERENCE = ["digikey", "mouser", "tme"] as const;

function preset(project: Project, name: string): ExportSelection {
    const found = builtInPresets(project).find(p => p.name === name);
    if (!found) {
        throw new Error(`no preset ${name}`);
    }
    return found.selection;
}

describe("export", () => {
    it("offers presets for the BOM's suppliers", () => {
        expect(builtInPresets(sampleProject()).map(p => p.name)).toEqual([
            "All data",
            "All DigiKey data",
            "Best price from DigiKey",
            "All Mouser data",
            "Best price from Mouser",
            "Not available anywhere"
        ]);
    });

    it("writes all data with the scope's column names and numbers as numbers", () => {
        const project = sampleProject();
        const sheet = buildBomSheet(
            project,
            PREFERENCE,
            preset(project, "All data")
        );
        const [headers, c1] = sheet.rows;
        expect(headers).toEqual([
            "Row",
            "Reference",
            "Value",
            "Qty",
            "Footprint",
            "DigiKey",
            "DigiKey_Manufacturer",
            "DigiKey_Stock Qty",
            "DigiKey_MOQ",
            "DigiKey_Order Qty",
            "DigiKey_Unit price",
            "DigiKey_Total price",
            "DigiKey_Availability",
            "DigiKey_Status",
            "DigiKey_RoHS",
            "Mouser",
            "Mouser_Manufacturer",
            "Mouser_Stock Qty",
            "Mouser_MOQ",
            "Mouser_Order Qty",
            "Mouser_Unit price",
            "Mouser_Total price",
            "Mouser_Availability",
            "Mouser_Status",
            "Mouser_RoHS",
            "Best_Supplier",
            "Best_Order Qty",
            "Best_Unit price",
            "Best_Total price",
            "Notes"
        ]);
        expect(c1).toEqual([
            1,
            "C1",
            "100n",
            20,
            "",
            "DK-1",
            "Yageo",
            1000,
            1,
            20,
            1.2,
            24,
            "In stock",
            "Active",
            "RoHS Compliant",
            "M-1",
            "Yageo",
            10,
            1,
            20,
            1,
            20,
            "Partial: 10",
            "Active",
            "RoHS Compliant",
            "DigiKey",
            20,
            1.2,
            24,
            "check"
        ]);
        expect(sheet.rows).toHaveLength(4);
        expect(sheet.numberFormats[headers!.indexOf("Mouser_Unit price")]).toBe(
            "0.0000"
        );
    });

    it("exports the rows where a supplier has the best price", () => {
        const project = sampleProject();
        const sheet = buildBomSheet(
            project,
            PREFERENCE,
            preset(project, "Best price from Mouser")
        );
        expect(sheet.rows[0]).toContain("Best_Supplier");
        expect(sheet.rows[0]).not.toContain("DigiKey");
        // U1 only: C1 goes to DigiKey (Mouser lacks stock), J1 isn't found.
        expect(sheet.rows.slice(1).map(row => row[1])).toEqual(["U1"]);
        expect(sheet.rows[1]!.at(-1)).toBeCloseTo(21); // MOQ 10 × 2.10
    });

    it("exports all of one supplier's rows, and the rows nobody can deliver", () => {
        const project = sampleProject();
        const mouser = buildBomSheet(
            project,
            PREFERENCE,
            preset(project, "All Mouser data")
        );
        expect(mouser.rows.slice(1).map(row => row[1])).toEqual([
            "C1",
            "U1",
            "J1"
        ]);
        expect(mouser.rows[3]).toContain("Not found");
        const missing = buildBomSheet(
            project,
            PREFERENCE,
            preset(project, "Not available anywhere")
        );
        expect(missing.rows.slice(1).map(row => row[1])).toEqual(["J1"]);
    });

    it("describes the export on an Info sheet", () => {
        const project = sampleProject();
        const selection = preset(project, "All data");
        const bom = buildBomSheet(project, PREFERENCE, selection);
        const info = buildInfoSheet(project, bom, {
            documentName: "Board",
            exportedAt: AT,
            presetName: "All data",
            selection,
            preference: PREFERENCE
        });
        const entries = Object.fromEntries(
            info.rows
                .filter(row => row.length === 2)
                .map(([label, value]) => [String(label), value])
        );
        expect(entries).toMatchObject({
            BOM: "Board",
            Filter: "All data",
            "Exported rows": 3,
            Exported: formatDateTime(AT),
            "Mouser data": `Collected ${formatDateTime(AT)}`,
            "DigiKey data": `Collected ${formatDateTime(AT)}`,
            "Best price total (EUR)": 45
        });
    });
});
