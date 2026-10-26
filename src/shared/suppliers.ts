import { SUPPLIER_IDS, type SupplierId } from "./model";

export interface SupplierInfo {
    id: SupplierId;
    /** Display name; also the part-number column name and the prefix of
     *  collected-data columns, e.g. "Mouser_Stock Qty". */
    name: string;
    /** Matches CSV headers and KiCad field names holding its part numbers. */
    headerPattern: RegExp;
}

export const SUPPLIERS: Record<SupplierId, SupplierInfo> = {
    digikey: { id: "digikey", name: "DigiKey", headerPattern: /^digi-?key\b/i },
    mouser: { id: "mouser", name: "Mouser", headerPattern: /^mouser\b/i },
    tme: { id: "tme", name: "TME", headerPattern: /^tme\b/i }
};

export const ALL_SUPPLIERS: readonly SupplierInfo[] = SUPPLIER_IDS.map(
    id => SUPPLIERS[id]
);

/** Sorts supplier ids into the canonical column order. */
export function sortSuppliers(ids: Iterable<SupplierId>): SupplierId[] {
    return [...new Set(ids)].sort(
        (a, b) => SUPPLIER_IDS.indexOf(a) - SUPPLIER_IDS.indexOf(b)
    );
}
