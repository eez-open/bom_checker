// The .eezbom project file: the Project as JSON. When the format changes,
// bump PROJECT_SCHEMA_VERSION, update the schema below and add a migration
// from the previous version to MIGRATIONS, with a test using an old file.

import { z } from "zod";
import {
    MAX_BUILD_QUANTITY,
    PROJECT_SCHEMA_VERSION,
    SUPPLIER_IDS,
    type Project
} from "./model";

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

const offerSchema = z.object({
    supplierPartNumber: z.string(),
    manufacturer: z.string(),
    manufacturerPartNumber: z.string(),
    description: z.string(),
    packaging: z.string().optional(),
    stockQty: z.number().nonnegative(),
    moq: z.number().int().positive(),
    orderMultiple: z.number().int().positive(),
    priceBreaks: z.array(
        z.object({ qty: z.number().positive(), unitPrice: z.number() })
    ),
    priceKind: z.enum(["account", "list", "unknown"]),
    currency: z.string(),
    lifecycle: z
        .enum([
            "active",
            "new",
            "nrnd",
            "eol",
            "special-order",
            "obsolete",
            "not-orderable"
        ])
        .nullable(),
    lifecycleRaw: z.string().nullable(),
    rohs: z.string().nullable(),
    productUrl: z.string().optional(),
    datasheetUrl: z.string().optional(),
    notes: z.array(z.string()).optional()
});

const resultBase = { runId: z.string(), fetchedAt: z.string() };

const lookupResultSchema = z.discriminatedUnion("status", [
    z.object({
        ...resultBase,
        status: z.literal("found"),
        offer: offerSchema,
        matchedBy: z.enum(["supplierPartNumber", "mpn"])
    }),
    z.object({ ...resultBase, status: z.literal("notFound") }),
    z.object({
        ...resultBase,
        status: z.literal("ambiguous"),
        candidates: z.array(offerSchema)
    }),
    z.object({
        ...resultBase,
        status: z.literal("error"),
        message: z.string()
    })
]);

const collectedSchema = z.object({
    results: z.partialRecord(
        supplierId,
        z.record(z.string(), lookupResultSchema)
    ),
    runs: z.partialRecord(
        supplierId,
        z.object({
            id: z.string(),
            startedAt: z.string(),
            endedAt: z.string().optional(),
            state: z.enum(["running", "complete", "interrupted"]),
            reason: z.string().optional()
        })
    )
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
        rows: z.array(rowSchema),
        buildQuantity: z.number().int().min(1).max(MAX_BUILD_QUANTITY),
        collected: collectedSchema
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
const MIGRATIONS: Partial<Record<number, Migration>> = {
    // Version 2 added collected supplier data.
    1: data => ({ ...data, collected: { results: {}, runs: {} } }),
    // Version 3 added the build quantity.
    2: data => ({ ...data, buildQuantity: 1 })
};

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
