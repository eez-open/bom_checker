import type { SupplierId } from "../../shared/model";
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
    lcsc
};
