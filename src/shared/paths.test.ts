import { describe, expect, it } from "vitest";
import { relativeToFile } from "./paths";

describe("paths relative to a BOM", () => {
    it("go from the BOM's folder", () => {
        const bom = "C:\\Work\\Device\\psu\\psu.eezbom";
        expect(relativeToFile(bom, "C:\\Work\\Device\\psu\\psu.csv")).toBe(
            "psu.csv"
        );
        expect(
            relativeToFile(bom, "c:\\work\\device\\psu\\kicad\\psu.kicad_pro")
        ).toBe("kicad/psu.kicad_pro");
        expect(relativeToFile(bom, "C:\\Work\\Device\\board.csv")).toBe(
            "../board.csv"
        );
        expect(
            relativeToFile("/home/me/a/b.eezbom", "/home/me/c/d.kicad_pro")
        ).toBe("../c/d.kicad_pro");
    });

    it("are the file name without a BOM file or on another drive", () => {
        expect(relativeToFile(null, "C:\\Work\\board.csv")).toBe("board.csv");
        expect(
            relativeToFile("C:\\Work\\psu.eezbom", "D:\\Data\\board.csv")
        ).toBe("board.csv");
    });
});
