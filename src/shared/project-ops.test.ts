import { describe, expect, it } from "vitest";
import type { Project } from "./model";
import {
    addCustomColumn,
    addRow,
    addSupplier,
    countReferences,
    createProject,
    createRow,
    customColumnHasValues,
    deleteCustomColumn,
    deleteRows,
    removeSupplier,
    replacePartNumber,
    renameCustomColumn,
    setCell,
    supplierHasValues,
    uniqueColumnName,
    validateColumnName
} from "./project-ops";

function projectWithRow(): { project: Project; rowId: string } {
    const row = createRow({ reference: "C1", value: "100n" });
    return { project: addRow(createProject(), row), rowId: row.id };
}

describe("rows", () => {
    it("starts empty and adds rows with Qty 1", () => {
        const project = addRow(createProject());
        expect(project.rows).toHaveLength(1);
        expect(project.rows[0]).toMatchObject({ reference: "", qty: 1 });
    });

    it("deletes rows by id and returns the same project when none match", () => {
        const { project, rowId } = projectWithRow();
        expect(deleteRows(project, [rowId]).rows).toHaveLength(0);
        expect(deleteRows(project, ["unknown"])).toBe(project);
    });

    it("does not mutate its input", () => {
        const { project, rowId } = projectWithRow();
        const snapshot = structuredClone(project);
        setCell(project, rowId, { kind: "base", field: "value" }, "1u");
        deleteRows(project, [rowId]);
        expect(project).toEqual(snapshot);
    });
});

describe("setCell", () => {
    it("trims text", () => {
        const { project, rowId } = projectWithRow();
        const next = setCell(
            project,
            rowId,
            { kind: "base", field: "footprint" },
            "  0603 "
        );
        expect(next.rows[0]?.footprint).toBe("0603");
    });

    it("returns the same project when the value doesn't change", () => {
        const { project, rowId } = projectWithRow();
        const key = { kind: "base", field: "value" } as const;
        expect(setCell(project, rowId, key, " 100n ")).toBe(project);
    });

    it("accepts non-negative whole and decimal numbers for Qty", () => {
        const { project, rowId } = projectWithRow();
        const key = { kind: "base", field: "qty" } as const;
        const qty = (raw: unknown) =>
            setCell(project, rowId, key, raw).rows[0]?.qty;
        expect(qty("12")).toBe(12);
        expect(qty(7)).toBe(7);
        // E.g. metres of tape per device.
        expect(qty(1.5)).toBe(1.5);
        expect(qty("0.004")).toBe(0.004);
        expect(qty("0,004")).toBe(0.004);
        expect(setCell(project, rowId, key, "abc")).toBe(project);
        expect(setCell(project, rowId, key, "1.2.3")).toBe(project);
        expect(setCell(project, rowId, key, -1)).toBe(project);
        expect(setCell(project, rowId, key, null)).toBe(project);
    });

    it("stores trimmed part numbers and removes empty ones", () => {
        const { project, rowId } = projectWithRow();
        const key = { kind: "partNumber", supplier: "mouser" } as const;
        const withPn = setCell(project, rowId, key, " 81-GRT1885C2A102JA2D ");
        expect(withPn.rows[0]?.partNumbers).toEqual({
            mouser: "81-GRT1885C2A102JA2D"
        });
        expect(setCell(withPn, rowId, key, "  ").rows[0]?.partNumbers).toEqual(
            {}
        );
    });

    it("converts custom number columns and keeps invalid input out", () => {
        const added = addCustomColumn(
            projectWithRow().project,
            "Price",
            "number"
        );
        const rowId = added.project.rows[0]!.id;
        const key = { kind: "custom", id: added.column.id } as const;
        const set = setCell(added.project, rowId, key, "2.5");
        expect(set.rows[0]?.custom).toEqual({ [added.column.id]: 2.5 });
        expect(setCell(set, rowId, key, "abc")).toBe(set);
        expect(setCell(set, rowId, key, "").rows[0]?.custom).toEqual({});
    });
});

describe("supplier columns", () => {
    it("keeps suppliers in DigiKey, Mouser, TME order", () => {
        let project = addSupplier(createProject(), "tme");
        project = addSupplier(project, "digikey");
        project = addSupplier(project, "mouser");
        expect(project.suppliers).toEqual(["digikey", "mouser", "tme"]);
        expect(addSupplier(project, "tme")).toBe(project);
    });

    it("removes the column together with its part numbers", () => {
        const { project: base, rowId } = projectWithRow();
        const project = setCell(
            addSupplier(base, "tme"),
            rowId,
            { kind: "partNumber", supplier: "tme" },
            "CL21B105KOFNNNE"
        );
        expect(supplierHasValues(project, "tme")).toBe(true);
        const removed = removeSupplier(project, "tme");
        expect(removed.suppliers).toEqual([]);
        expect(removed.rows[0]?.partNumbers).toEqual({});
    });
});

describe("custom columns", () => {
    it("rejects empty, built-in, reserved and duplicate names", () => {
        const { project } = addCustomColumn(createProject(), "Farnell", "text");
        expect(validateColumnName(project, " ")).toMatch(/Enter/);
        expect(validateColumnName(project, "qty")).toMatch(/built-in/);
        expect(validateColumnName(project, "Mouser")).toMatch(/built-in/);
        expect(validateColumnName(project, "Mouser_Stock Qty")).toMatch(
            /reserved/
        );
        expect(validateColumnName(project, "best_price")).toMatch(/reserved/);
        expect(validateColumnName(project, "farnell")).toMatch(
            /already exists/
        );
        expect(validateColumnName(project, "Notes")).toBeNull();
    });

    it("allows renaming a column to its own name in another case", () => {
        const { project, column } = addCustomColumn(
            createProject(),
            "notes",
            "text"
        );
        const renamed = renameCustomColumn(project, column.id, "Notes");
        expect(renamed.customColumns[0]?.name).toBe("Notes");
    });

    it("makes imported names unique", () => {
        const { project } = addCustomColumn(createProject(), "Farnell", "text");
        expect(uniqueColumnName(project, "Farnell")).toBe("Farnell (2)");
        expect(uniqueColumnName(project, "Value")).toBe("Value (2)");
        expect(uniqueColumnName(project, "")).toBe("Column");
    });

    it("deletes a column together with its values", () => {
        const added = addCustomColumn(
            projectWithRow().project,
            "Notes",
            "text"
        );
        const rowId = added.project.rows[0]!.id;
        const project = setCell(
            added.project,
            rowId,
            { kind: "custom", id: added.column.id },
            "check"
        );
        expect(customColumnHasValues(project, added.column.id)).toBe(true);
        const deleted = deleteCustomColumn(project, added.column.id);
        expect(deleted.customColumns).toEqual([]);
        expect(deleted.rows[0]?.custom).toEqual({});
    });
});

describe("helpers", () => {
    it("counts references", () => {
        expect(countReferences("C1,C2,C3,C4,C32,C59")).toBe(6);
        expect(countReferences(" R1, R2 ")).toBe(2);
        expect(countReferences("")).toBe(0);
    });
});

describe("replacePartNumber", () => {
    it("replaces a part number in every row that uses it", () => {
        let project = addRow(
            createProject(),
            createRow({ partNumbers: { digikey: "rmcf0805ft100k " } })
        );
        project = addRow(
            project,
            createRow({ partNumbers: { digikey: "RMCF0805FT100K" } })
        );
        project = addRow(
            project,
            createRow({ partNumbers: { digikey: "OTHER" } })
        );
        const replaced = replacePartNumber(
            project,
            "digikey",
            "RMCF0805FT100K",
            "RMCF0805FT100KCT-ND"
        );
        expect(replaced.rows.map(row => row.partNumbers.digikey)).toEqual([
            "RMCF0805FT100KCT-ND",
            "RMCF0805FT100KCT-ND",
            "OTHER"
        ]);
        expect(replacePartNumber(replaced, "digikey", "NOPE", "X")).toBe(
            replaced
        );
    });
});
