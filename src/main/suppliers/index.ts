import type { SupplierId } from "../../shared/model";
import {
    ARROW_SOURCES,
    type SupplierConfig
} from "../../shared/supplier-config";
import { arrowPlugin } from "./arrow";
import { digikey } from "./digikey";
import { lcsc } from "./lcsc";
import { mouser } from "./mouser";
import { tme } from "./tme";
import type { SupplierPlugin } from "./types";

/** All supplier integrations. Adding a supplier: implement SupplierPlugin
 *  in a new file, add it here and to the shared supplier lists. */
export const PLUGINS: Record<SupplierId, SupplierPlugin> = {
    digikey,
    mouser,
    tme,
    lcsc,
    // One per inventory source (#62).
    ...(Object.fromEntries(
        ARROW_SOURCES.map(source => [
            source.supplier,
            arrowPlugin(source.supplier)
        ])
    ) as Record<(typeof ARROW_SOURCES)[number]["supplier"], SupplierPlugin>)
};

/** Part numbers per `lookup` call, with these settings. */
export function batchSizeOf(
    plugin: SupplierPlugin,
    config: SupplierConfig
): number {
    return Math.max(1, plugin.batchSizeFor?.(config) ?? plugin.batchSize);
}
