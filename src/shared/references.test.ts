import { describe, expect, it } from "vitest";
import {
    duplicateReferences,
    joinReferences,
    quantityMismatch
} from "./references";

const row = (id: string, reference: string, qty = 1) => ({
    id,
    reference,
    qty
});

describe("references", () => {
    it("joins references in natural order", () => {
        expect(joinReferences(["C10", "C2", "R1", "C1"])).toBe("C1,C2,C10,R1");
    });

    it("finds references that are in more than one row (#58)", () => {
        const problems = duplicateReferences([
            row("a", "C1, C2", 2),
            row("b", "C3"),
            row("c", "c2,C4", 2),
            row("d", "C2"),
            row("e", "R1 R1", 2)
        ]);
        expect(Object.fromEntries(problems)).toEqual({
            a: "C2 is also in rows 3, 4.",
            c: "c2 is also in rows 1, 4.",
            d: "C2 is also in rows 1, 3.",
            e: "R1 is listed twice."
        });
        expect(duplicateReferences([row("a", "C1"), row("b", "")])).toEqual(
            new Map()
        );
    });

    it("compares Qty with the number of references (#58)", () => {
        expect(quantityMismatch(row("a", "C1, C2, C3", 2))).toBe(
            "3 references, but Qty is 2."
        );
        expect(quantityMismatch(row("a", "C1", 3))).toBe(
            "1 reference, but Qty is 3."
        );
        expect(quantityMismatch(row("a", "C1,C2", 2))).toBeNull();
        // Without references, or an amount such as metres of tape.
        expect(quantityMismatch(row("a", "", 4))).toBeNull();
        expect(quantityMismatch(row("a", "TAPE1", 0.004))).toBeNull();
    });
});
