// The kinds of file the app opens: from Open Recent, or dropped on the
// window. Main reads each kind differently.

import { BOM_LIST_FILE_EXTENSION } from "./bom-list-file";
import { PROJECT_FILE_EXTENSION } from "./project-file";

export type DocumentKind = "project" | "list" | "csv" | "kicad";

export function documentKind(path: string): DocumentKind | null {
    const name = path.toLowerCase();
    if (name.endsWith(`.${PROJECT_FILE_EXTENSION}`)) {
        return "project";
    }
    if (name.endsWith(`.${BOM_LIST_FILE_EXTENSION}`)) {
        return "list";
    }
    if (name.endsWith(".csv")) {
        return "csv";
    }
    if (name.endsWith(".kicad_pro")) {
        return "kicad";
    }
    return null;
}
