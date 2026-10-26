import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION } from "./model";
import { parseProjectFile, serializeProject } from "./project-file";
import {
    addCustomColumn,
    addRow,
    addSupplier,
    createProject,
    createRow
} from "./project-ops";

function sampleProject() {
    const { project, column } = addCustomColumn(
        addSupplier(createProject(), "mouser"),
        "LCSC",
        "text"
    );
    return addRow(
        project,
        createRow({
            reference: "C1,C2",
            value: "1n",
            qty: 2,
            footprint: "C_0603_1608Metric",
            partNumbers: { mouser: "81-GRT1885C2A102JA2D" },
            custom: { [column.id]: "C1588" }
        })
    );
}

function fileWith(changes: Record<string, unknown>): string {
    return JSON.stringify({ ...sampleProject(), ...changes });
}

describe("project file", () => {
    it("round-trips a project", () => {
        const project = sampleProject();
        expect(parseProjectFile(serializeProject(project))).toEqual(project);
    });

    it("rejects text that isn't JSON", () => {
        expect(() => parseProjectFile("Reference,Value")).toThrow(/isn't JSON/);
    });

    it("rejects JSON without a format version", () => {
        expect(() => parseProjectFile('{"rows": []}')).toThrow(
            /not an EEZ BOM checker project/
        );
    });

    it("rejects files from a newer app version", () => {
        const text = fileWith({ schemaVersion: PROJECT_SCHEMA_VERSION + 1 });
        expect(() => parseProjectFile(text)).toThrow(/newer version/);
    });

    it("reports invalid content", () => {
        const project = sampleProject();
        const text = fileWith({
            rows: [{ ...project.rows[0], qty: -3 }]
        });
        expect(() => parseProjectFile(text)).toThrow(/damaged[\s\S]*qty/);
    });

    it("rejects unknown suppliers", () => {
        expect(() =>
            parseProjectFile(fileWith({ suppliers: ["lcsc"] }))
        ).toThrow(/damaged/);
    });

    it("rejects duplicate row ids", () => {
        const row = sampleProject().rows[0];
        expect(() => parseProjectFile(fileWith({ rows: [row, row] }))).toThrow(
            /unique/
        );
    });
});
