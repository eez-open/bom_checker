// The .eezbom project file: the Project as JSON, without the collected
// supplier data and the prices typed for suppliers without an API, which
// are kept on the computer (main/project/supplier-data.ts). When the format changes, bump PROJECT_SCHEMA_VERSION,
// update the schema below and add a migration from the previous version to
// MIGRATIONS, with a test using an old file.

import { z } from "zod";
import {
    MAX_BUILD_QUANTITY,
    MAX_MANUAL_PRICE_BREAKS,
    PROJECT_SCHEMA_VERSION,
    SUPPLIER_IDS,
    type BomRow,
    type CollectedData,
    type ManualOffer,
    type Project
} from "./model";

export const PROJECT_FILE_EXTENSION = "eezbom";

export class ProjectFileError extends Error {
    override name = "ProjectFileError";
}

const supplierId = z.enum(SUPPLIER_IDS);

const manualOfferSchema = z.object({
    partNumber: z.string().optional(),
    unitPrice: z.number().nonnegative().optional(),
    priceBreaks: z
        .array(
            z.object({
                qty: z.number().gt(1),
                unitPrice: z.number().nonnegative()
            })
        )
        .max(MAX_MANUAL_PRICE_BREAKS)
        .refine(
            breaks =>
                breaks.every((b, i) => i === 0 || b.qty > breaks[i - 1]!.qty),
            "price break quantities must go up"
        )
        .optional(),
    stock: z.number().nonnegative().optional(),
    moq: z.number().positive().optional(),
    oneTime: z.literal(true).optional()
});

const rowSchema = z.object({
    id: z.string().min(1),
    reference: z.string(),
    value: z.string(),
    qty: z.number().nonnegative(),
    footprint: z.string(),
    partNumbers: z.partialRecord(supplierId, z.string()),
    custom: z.record(z.string(), z.union([z.string(), z.number()])),
    manual: z.record(z.string(), manualOfferSchema).optional()
});

/**
 * What's typed for a supplier without an API that's kept on the computer,
 * not in the file (#68): its prices, stock and MOQ, which the suppliers'
 * customers may not want to publish. Its part number and whether it's a
 * one-time item stay in the file, like the other suppliers' part numbers.
 */
export const MANUAL_PRICE_FIELDS = [
    "unitPrice",
    "priceBreaks",
    "stock",
    "moq"
] as const;

export type ManualPriceFields = Pick<
    ManualOffer,
    (typeof MANUAL_PRICE_FIELDS)[number]
>;

/** By row id, then by the id of the supplier without an API. */
export type ManualPrices = Record<string, Record<string, ManualPriceFields>>;

export const manualPricesSchema: z.ZodType<ManualPrices> = z.record(
    z.string(),
    z.record(
        z.string(),
        manualOfferSchema.pick({
            unitPrice: true,
            priceBreaks: true,
            stock: true,
            moq: true
        })
    )
);

function priceFields(offer: ManualOffer): ManualPriceFields | null {
    const fields: ManualPriceFields = {};
    for (const field of MANUAL_PRICE_FIELDS) {
        if (offer[field] !== undefined) {
            (fields as Record<string, unknown>)[field] = offer[field];
        }
    }
    return Object.keys(fields).length > 0 ? fields : null;
}

/** The prices, stock and MOQ typed for suppliers without an API (#68). */
export function manualPricesOf(project: Project): ManualPrices {
    const prices: ManualPrices = {};
    for (const row of project.rows) {
        for (const [supplier, offer] of Object.entries(row.manual ?? {})) {
            const fields = priceFields(offer);
            if (fields) {
                (prices[row.id] ??= {})[supplier] = fields;
            }
        }
    }
    return prices;
}

export function hasManualPrices(project: Project): boolean {
    return Object.keys(manualPricesOf(project)).length > 0;
}

/** The project without them, as the file has it. */
export function withoutManualPrices(project: Project): Project {
    if (!hasManualPrices(project)) {
        return project;
    }
    return {
        ...project,
        rows: project.rows.map(row => {
            if (!row.manual) {
                return row;
            }
            const manual: Record<string, ManualOffer> = {};
            for (const [supplier, offer] of Object.entries(row.manual)) {
                const kept: ManualOffer = { ...offer };
                for (const field of MANUAL_PRICE_FIELDS) {
                    delete kept[field];
                }
                if (Object.keys(kept).length > 0) {
                    manual[supplier] = kept;
                }
            }
            if (Object.keys(manual).length > 0) {
                return { ...row, manual };
            }
            const next: BomRow = { ...row };
            delete next.manual;
            return next;
        })
    };
}

/** The project with the prices kept on the computer, for its rows and
 *  suppliers. */
export function withManualPrices(
    project: Project,
    prices: ManualPrices
): Project {
    const suppliers = new Set(project.manualSuppliers.map(s => s.id));
    let changed = false;
    const rows = project.rows.map(row => {
        const kept = Object.entries(prices[row.id] ?? {}).filter(([supplier]) =>
            suppliers.has(supplier)
        );
        if (kept.length === 0) {
            return row;
        }
        changed = true;
        const manual = { ...row.manual };
        for (const [supplier, fields] of kept) {
            manual[supplier] = { ...manual[supplier], ...fields };
        }
        return { ...row, manual };
    });
    return changed ? { ...project, rows } : project;
}

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

export const collectedSchema = z.object({
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
        id: z.string().min(1).optional(),
        source: z.object({
            kind: z.enum(["manual", "csv", "kicad"]),
            path: z.string().optional(),
            variant: z.string().optional(),
            importedAt: z.string().optional(),
            kicadValues: z
                .record(z.string(), z.record(z.string(), z.string()))
                .optional()
        }),
        suppliers: z.array(supplierId),
        customColumns: z.array(
            z.object({
                id: z.string().min(1),
                name: z.string().min(1),
                type: z.enum(["text", "number"])
            })
        ),
        manualSuppliers: z.array(
            z.object({ id: z.string().min(1), name: z.string().min(1) })
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
    2: data => ({ ...data, buildQuantity: 1 }),
    // Version 4 added KiCad's values for Sync KiCad…; files without them
    // are compared without knowing which side changed.
    3: data => data,
    // Version 5 allows decimal quantities and adds suppliers without an API.
    4: data => ({ ...data, manualSuppliers: [] }),
    // Version 6 leaves out the collected supplier data: the suppliers' terms
    // don't allow passing it on, and BOM files are often published. An
    // older file's data is still read, for main to move it out.
    5: data => data,
    // Version 7 adds price breaks (#51) and one-time items (#53) to
    // suppliers without an API.
    6: data => data,
    // Version 8 leaves out the prices, stock and MOQ typed for suppliers
    // without an API (#68), and adds the BOM's id. An older file's prices
    // are still read, for main to move them out.
    7: data => data
};

const NO_COLLECTED_DATA = { results: {}, runs: {} };

/** Whether `collected` has any results or runs. */
export function hasCollectedData(collected: CollectedData): boolean {
    return (
        Object.values(collected.results).some(
            results => Object.keys(results).length > 0
        ) || Object.keys(collected.runs).length > 0
    );
}

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
    return validateProject({ collected: NO_COLLECTED_DATA, ...file });
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

/** The file's text: the project without its collected supplier data and
 *  the prices of suppliers without an API (#68). */
export function serializeProject(project: Project): string {
    // JSON leaves out undefined properties.
    return (
        JSON.stringify(
            { ...withoutManualPrices(project), collected: undefined },
            null,
            2
        ) + "\n"
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
