import { describe, expect, it } from "vitest";
import { buildBomSheet, builtInPresets } from "./export";
import type { LookupResult, Project, SupplierOffer } from "./model";
import { bestSupplier, bomTotals, manualLine, manualTotal } from "./pricing";
import { parseProjectFile, serializeProject } from "./project-file";
import {
    addCustomColumn,
    addManualSupplier,
    addRow,
    addSupplier,
    createProject,
    createRow,
    deleteManualSupplier,
    renameManualSupplier,
    setCell,
    validateColumnName
} from "./project-ops";
import { numbersFor } from "./numbers";

// Suppliers without an API (#20): what's typed in counts like the rest.

const MOUSER: SupplierOffer = {
    supplierPartNumber: "M-1",
    manufacturer: "",
    manufacturerPartNumber: "",
    description: "",
    stockQty: 100,
    moq: 1,
    orderMultiple: 1,
    priceBreaks: [{ qty: 1, unitPrice: 1 }],
    priceKind: "list",
    currency: "EUR",
    lifecycle: "active",
    lifecycleRaw: null,
    rohs: null
};

/** A display at Mouser for 1 EUR, and a local shop. */
function bom(): { project: Project; shop: string; rowId: string } {
    const row = createRow({
        reference: "DS1",
        value: "TFT",
        qty: 2,
        partNumbers: { mouser: "M-1" }
    });
    const found: LookupResult = {
        status: "found",
        offer: MOUSER,
        matchedBy: "supplierPartNumber",
        runId: "r",
        fetchedAt: "2026-10-27T10:00:00Z"
    };
    const { project, supplier } = addManualSupplier(
        {
            ...addRow(addSupplier(createProject(), "mouser"), row),
            collected: { results: { mouser: { "M-1": found } }, runs: {} }
        },
        "Shop"
    );
    return { project, shop: supplier.id, rowId: row.id };
}

function type(
    project: Project,
    rowId: string,
    supplier: string,
    values: Record<string, unknown>
): Project {
    return Object.entries(values).reduce(
        (next, [field, value]) =>
            setCell(
                next,
                rowId,
                {
                    kind: "manual",
                    supplier,
                    field: field as "partNumber"
                },
                value
            ),
        project
    );
}

describe("suppliers without an API", () => {
    it("keeps what's typed, and clears it with an empty cell", () => {
        const { project, shop, rowId } = bom();
        const typed = type(project, rowId, shop, {
            partNumber: " TFT-35 ",
            unitPrice: "0.8",
            stock: 5
        });
        expect(typed.rows[0]!.manual).toEqual({
            [shop]: { partNumber: "TFT-35", unitPrice: 0.8, stock: 5 }
        });
        expect(type(typed, rowId, shop, { unitPrice: -1 })).toBe(typed);
        expect(type(typed, rowId, shop, { moq: 0 })).toBe(typed);
        expect(type(typed, rowId, shop, { unitPrice: "1.2.3" })).toBe(typed);
        // A decimal comma works too (#37).
        expect(
            type(typed, rowId, shop, { unitPrice: "0,75" }).rows[0]!.manual?.[
                shop
            ]?.unitPrice
        ).toBe(0.75);
        const cleared = type(typed, rowId, shop, {
            partNumber: "",
            unitPrice: null,
            stock: ""
        });
        expect(cleared.rows[0]!.manual).toEqual({});
    });

    it("competes for the best price, with stock taken into account", () => {
        const { project, shop, rowId } = bom();
        const best = (p: Project) =>
            bestSupplier(
                p.rows[0]!,
                p.collected,
                p.suppliers,
                [],
                1,
                p.manualSuppliers
            )?.supplier;

        // 2 × 0.80 beats 2 × 1.00; no stock typed means always available.
        const cheaper = type(project, rowId, shop, { unitPrice: 0.8 });
        expect(best(cheaper)).toBe(shop);
        expect(
            manualLine(cheaper.rows[0]!, cheaper.manualSuppliers[0]!, 1)
        ).toMatchObject({
            orderQty: 2,
            total: 1.6,
            availability: { kind: "in-stock" }
        });
        expect(bomTotals(cheaper, []).total).toBeCloseTo(1.6);
        expect(manualTotal(cheaper, cheaper.manualSuppliers[0]!)).toEqual({
            total: 1.6,
            priced: 1
        });
        // Not enough stock: Mouser.
        expect(best(type(cheaper, rowId, shop, { stock: 1 }))).toBe("mouser");
        // The MOQ raises the order: 10 × 0.80 is more than 2 × 1.00.
        expect(best(type(cheaper, rowId, shop, { moq: 10 }))).toBe("mouser");
        // Equal totals go to the supplier with an API.
        expect(best(type(project, rowId, shop, { unitPrice: 1 }))).toBe(
            "mouser"
        );
    });

    it("are named like columns, renamed and deleted with their data", () => {
        const { project, shop, rowId } = bom();
        expect(validateColumnName(project, "shop")).toMatch(/already exists/);
        expect(validateColumnName(project, "Shop_Notes")).toMatch(/reserved/);
        expect(validateColumnName(project, "Mouser")).toMatch(/built-in/);
        const withColumn = addCustomColumn(project, "Notes", "text").project;
        expect(() => addManualSupplier(withColumn, "notes")).toThrow(
            /already exists/
        );

        const typed = type(project, rowId, shop, { unitPrice: 2 });
        const renamed = renameManualSupplier(typed, shop, "Local shop");
        expect(renamed.manualSuppliers[0]!.name).toBe("Local shop");
        const deleted = deleteManualSupplier(renamed, shop);
        expect(deleted.manualSuppliers).toEqual([]);
        expect(deleted.rows[0]!.manual).toEqual({});
    });

    it("are saved in the BOM file", () => {
        const { project, shop, rowId } = bom();
        const typed = type(project, rowId, shop, {
            partNumber: "TFT-35",
            unitPrice: 12.5,
            moq: 1
        });
        // What was typed is the user's own; only collected data stays out.
        expect(parseProjectFile(serializeProject(typed))).toEqual({
            ...typed,
            collected: { results: {}, runs: {} }
        });

        // Files before format 5 have none.
        const old: Record<string, unknown> = {
            ...createProject(),
            schemaVersion: 4
        };
        delete old.manualSuppliers;
        expect(parseProjectFile(JSON.stringify(old)).manualSuppliers).toEqual(
            []
        );
    });

    it("are exported, also with part numbers only", () => {
        const { project, shop, rowId } = bom();
        const typed = type(project, rowId, shop, {
            partNumber: "TFT-35",
            unitPrice: 0.8
        });
        const preset = (name: string) =>
            builtInPresets(typed).find(p => p.name === name)!.selection;
        const all = buildBomSheet(
            typed,
            [],
            preset("All data"),
            numbersFor("en-US")
        );
        const headers = all.rows[0]!;
        expect(headers).toEqual(
            expect.arrayContaining([
                "Shop",
                "Shop_Unit price",
                "Shop_Total price",
                "Shop_Availability",
                "Best_Supplier"
            ])
        );
        expect(all.rows[1]![headers.indexOf("Shop_Total price")]).toBe(1.6);
        expect(all.rows[1]![headers.indexOf("Best_Supplier")]).toBe("Shop");

        const basic = buildBomSheet(
            typed,
            [],
            preset("Basic data only"),
            numbersFor("en-US")
        );
        expect(basic.rows[0]).toEqual([
            "Row",
            "Reference",
            "Value",
            "Qty",
            "Footprint",
            "Mouser",
            "Shop"
        ]);
    });
});
