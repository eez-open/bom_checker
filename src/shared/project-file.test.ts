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

describe("older project files", () => {
    it("opens a version 1 file (before collected data)", () => {
        const version1 = JSON.stringify({
            schemaVersion: 1,
            source: { kind: "manual" },
            suppliers: ["mouser"],
            customColumns: [],
            rows: [
                {
                    id: "r1",
                    reference: "C1",
                    value: "1n",
                    qty: 1,
                    footprint: "0603",
                    partNumbers: { mouser: "81-GRT1885C2A102JA2D" },
                    custom: {}
                }
            ]
        });
        const project = parseProjectFile(version1);
        expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
        expect(project.collected).toEqual({ results: {}, runs: {} });
        expect(project.buildQuantity).toBe(1);
        expect(project.rows[0]?.partNumbers.mouser).toBe(
            "81-GRT1885C2A102JA2D"
        );
    });

    it("opens a version 2 file (before the build quantity)", () => {
        const version2: Record<string, unknown> = {
            ...sampleProject(),
            schemaVersion: 2
        };
        delete version2.buildQuantity;
        const project = parseProjectFile(JSON.stringify(version2));
        expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
        expect(project.buildQuantity).toBe(1);
    });

    it("rejects a build quantity below 1", () => {
        expect(() => parseProjectFile(fileWith({ buildQuantity: 0 }))).toThrow(
            /damaged/
        );
    });
});

describe("collected data", () => {
    it("round-trips results and runs", () => {
        const project = {
            ...sampleProject(),
            collected: {
                results: {
                    mouser: {
                        "81-GRT1885C2A102JA2D": {
                            status: "found" as const,
                            runId: "run-1",
                            fetchedAt: "2026-10-26T10:00:00Z",
                            matchedBy: "supplierPartNumber" as const,
                            offer: {
                                supplierPartNumber: "81-GRT1885C2A102JA2D",
                                manufacturer: "Murata",
                                manufacturerPartNumber: "GRT1885C2A102JA02D",
                                description: "MLCC 1nF",
                                stockQty: 12000,
                                moq: 1,
                                orderMultiple: 1,
                                priceBreaks: [{ qty: 1, unitPrice: 0.1 }],
                                priceKind: "unknown" as const,
                                currency: "EUR",
                                lifecycle: "active" as const,
                                lifecycleRaw: null,
                                rohs: "RoHS Compliant"
                            }
                        },
                        "X-1": {
                            status: "notFound" as const,
                            runId: "run-1",
                            fetchedAt: "2026-10-26T10:00:00Z"
                        }
                    }
                },
                runs: {
                    mouser: {
                        id: "run-1",
                        startedAt: "2026-10-26T10:00:00Z",
                        endedAt: "2026-10-26T10:00:05Z",
                        state: "complete" as const
                    }
                }
            }
        };
        expect(parseProjectFile(serializeProject(project))).toEqual(project);
    });
});
