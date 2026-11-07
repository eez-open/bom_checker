import { SUPPLIER_IDS, type Project, type SupplierId } from "./model";
import { ARROW_SOURCES, type AccountId } from "./supplier-config";

export interface SupplierInfo {
    id: SupplierId;
    /** Display name; also the part-number column name and the prefix of
     *  collected-data columns, e.g. "Mouser_Stock Qty". */
    name: string;
    /** Matches CSV headers and KiCad field names holding its part numbers. */
    headerPattern: RegExp;
    /** Whose settings and credentials it uses. */
    account: AccountId;
    /** Arrow's inventory source (#62), e.g. "EUROPE". */
    source?: string;
    /** How long collected data may be kept (#62: Arrow's terms allow 48
     *  hours); no limit when not given. */
    maxAgeMs?: number;
}

const ARROW_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function arrowSupplier(
    source: (typeof ARROW_SOURCES)[number]
): [SupplierId, SupplierInfo] {
    return [
        source.supplier,
        {
            id: source.supplier,
            name: `Arrow (${source.code})`,
            // "Arrow (EUROPE)", "Arrow_EUROPE", "Arrow EUROPE"…
            headerPattern: new RegExp(
                `^arrow[\\s_(-]*${source.code.toLowerCase()}\\b`,
                "i"
            ),
            account: "arrow",
            source: source.code,
            maxAgeMs: ARROW_MAX_AGE_MS
        }
    ];
}

export const SUPPLIERS: Record<SupplierId, SupplierInfo> = {
    digikey: {
        id: "digikey",
        name: "DigiKey",
        headerPattern: /^digi-?key\b/i,
        account: "digikey"
    },
    mouser: {
        id: "mouser",
        name: "Mouser",
        headerPattern: /^mouser\b/i,
        account: "mouser"
    },
    tme: { id: "tme", name: "TME", headerPattern: /^tme\b/i, account: "tme" },
    lcsc: {
        id: "lcsc",
        name: "LCSC",
        headerPattern: /^lcsc\b/i,
        account: "lcsc"
    },
    ...(Object.fromEntries(ARROW_SOURCES.map(arrowSupplier)) as Record<
        (typeof ARROW_SOURCES)[number]["supplier"],
        SupplierInfo
    >)
};

/** Names of the accounts in Settings. */
export const ACCOUNT_NAMES: Record<AccountId, string> = {
    digikey: "DigiKey",
    mouser: "Mouser",
    tme: "TME",
    lcsc: "LCSC",
    arrow: "Arrow"
};

/** Whose settings and credentials a supplier uses. */
export function accountOf(supplier: SupplierId): AccountId {
    return SUPPLIERS[supplier].account;
}

export const ALL_SUPPLIERS: readonly SupplierInfo[] = SUPPLIER_IDS.map(
    id => SUPPLIERS[id]
);

/** Sorts supplier ids into the canonical column order. */
export function sortSuppliers(ids: Iterable<SupplierId>): SupplierId[] {
    return [...new Set(ids)].sort(
        (a, b) => SUPPLIER_IDS.indexOf(a) - SUPPLIER_IDS.indexOf(b)
    );
}

/** The name of a supplier with an API, or of one without (by its id). */
export function supplierName(
    project: Pick<Project, "manualSuppliers">,
    key: string
): string {
    return (SUPPLIER_IDS as readonly string[]).includes(key)
        ? SUPPLIERS[key as SupplierId].name
        : (project.manualSuppliers.find(s => s.id === key)?.name ?? key);
}
