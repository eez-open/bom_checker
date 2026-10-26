// The .eezbom project file: the Project as JSON. When the format changes,
// bump PROJECT_SCHEMA_VERSION, update the schema below and add a migration
// from the previous version to MIGRATIONS, with a test using an old file.

import { z } from "zod";
import { PROJECT_SCHEMA_VERSION, SUPPLIER_IDS, type Project } from "./model";

export const PROJECT_FILE_EXTENSION = "eezbom";

export class ProjectFileError extends Error {
    override name = "ProjectFileError";
}

const supplierId = z.enum(SUPPLIER_IDS);

const rowSchema = z.object({
    id: z.string().min(1),
    reference: z.string(),
    value: z.string(),
    qty: z.number().int().nonnegative(),
    footprint: z.string(),
    partNumbers: z.partialRecord(supplierId, z.string()),
    custom: z.record(z.string(), z.union([z.string(), z.number()]))
});

const projectSchema: z.ZodType<Project> = z
    .object({
        schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
        source: z.object({
            kind: z.enum(["manual", "csv", "kicad"]),
            path: z.string().optional(),
            variant: z.string().optional(),
            importedAt: z.string().optional()
        }),
        suppliers: z.array(supplierId),
        customColumns: z.array(
            z.object({
                id: z.string().min(1),
                name: z.string().min(1),
                type: z.enum(["text", "number"])
            })
        ),
        rows: z.array(rowSchema)
    })
    .superRefine((project, context) => {
        for (const [path, ids] of [
            ["rows", project.rows.map(row => row.id)],
            ["customColumns", project.customColumns.map(column => column.id)]
        ] as const) {
            if (new Set(ids).size !== ids.length) {
                context.addIssue({
                    code: "custom",
                    path: [path],
                    message: "ids must be unique"
                });
            }
        }
    });

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] converts a version-n file into version n + 1. */
const MIGRATIONS: Partial<Record<number, Migration>> = {};

export function parseProjectFile(text: string): Project {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new ProjectFileError(
            "The file is not an EEZ BOM checker project (it isn't JSON)."
        );
    }
    if (!isRecord(data) || typeof data.schemaVersion !== "number") {
        throw new ProjectFileError(
            "The file is not an EEZ BOM checker project."
        );
    }
    let file = data;
    let version = data.schemaVersion;
    if (version > PROJECT_SCHEMA_VERSION) {
        throw new ProjectFileError(
            `The file was saved by a newer version of EEZ BOM checker ` +
                `(file format ${version}). Update the app to open it.`
        );
    }
    while (version < PROJECT_SCHEMA_VERSION) {
        const migrate = MIGRATIONS[version];
        if (!migrate) {
            throw new ProjectFileError(
                `File format ${version} is no longer supported.`
            );
        }
        version++;
        file = { ...migrate(file), schemaVersion: version };
    }
    return validateProject(file);
}

/** Validates a project from an untrusted source (a file or the renderer). */
export function validateProject(data: unknown): Project {
    const result = projectSchema.safeParse(data);
    if (!result.success) {
        throw new ProjectFileError(
            "The file is damaged or not an EEZ BOM checker project:\n" +
                z.prettifyError(result.error)
        );
    }
    return result.data;
}

export function serializeProject(project: Project): string {
    return JSON.stringify(project, null, 2) + "\n";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
