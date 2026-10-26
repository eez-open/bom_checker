// Maps each supplier's product status to one scale ("BOM checker
// architecture.md", 5.4). Unknown texts give null; the raw text is kept in
// the offer and shown in tooltips.

import type { Lifecycle } from "./model";

/** Least to most severe; used when a supplier reports several flags. */
export const LIFECYCLE_SEVERITY: readonly Lifecycle[] = [
    "active",
    "new",
    "special-order",
    "nrnd",
    "eol",
    "obsolete",
    "not-orderable"
];

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
    active: "Active",
    new: "New",
    "special-order": "Special order",
    nrnd: "NRND",
    eol: "Last time buy / EOL",
    obsolete: "Obsolete",
    "not-orderable": "Not orderable"
};

const DIGIKEY: Record<string, Lifecycle> = {
    active: "active",
    preliminary: "new",
    "not for new designs": "nrnd",
    "last time buy": "eol",
    obsolete: "obsolete",
    "discontinued at digi-key": "obsolete"
};

const MOUSER: Record<string, Lifecycle> = {
    "new product": "new",
    "new at mouser": "new",
    "not recommended for new designs": "nrnd",
    "end of life": "eol",
    obsolete: "obsolete",
    "factory special order": "special-order"
};

const TME: Record<string, Lifecycle> = {
    NEW: "new",
    ONLY_FOR_SPECIAL_ORDER: "special-order",
    AVAILABLE_WHILE_STOCKS_LAST: "eol",
    MOQ_VALID_WHILE_STOCKS_LAST: "eol",
    NOT_IN_OFFER: "not-orderable",
    CANNOT_BE_ORDERED: "not-orderable",
    PRODUCT_BLOCKED: "not-orderable",
    INVALID: "not-orderable"
};

/** DigiKey `ProductStatus.Status` (requested in English). */
export function digikeyLifecycle(
    status: string | null | undefined
): Lifecycle | null {
    return status ? (DIGIKEY[status.trim().toLowerCase()] ?? null) : null;
}

/** Mouser leaves `LifecycleStatus` out for active parts (seen in real
 *  responses; to be confirmed with live data). */
export function mouserLifecycle(
    status: string | null | undefined,
    discontinued: boolean
): Lifecycle | null {
    if (discontinued) {
        return "obsolete";
    }
    if (!status) {
        return "active";
    }
    return MOUSER[status.trim().toLowerCase()] ?? null;
}

/** TME reports a set of flags; the most severe one counts. */
export function tmeLifecycle(flags: readonly string[]): Lifecycle {
    return mostSevere(
        flags.map(flag => TME[flag.toUpperCase()]).filter(isDefined)
    );
}

export function mostSevere(values: readonly Lifecycle[]): Lifecycle {
    return values.reduce<Lifecycle>(
        (worst, value) =>
            LIFECYCLE_SEVERITY.indexOf(value) >
            LIFECYCLE_SEVERITY.indexOf(worst)
                ? value
                : worst,
        "active"
    );
}

function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined;
}
