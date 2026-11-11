// Suppliers that disable API access after a time without use (#82): LCSC
// after 180 days. The app remembers when each supplier last answered, shows
// it in its settings, and warns when the app starts 30 days before.

import { formatDateTime } from "./collection";
import {
    ACCOUNT_IDS,
    SUPPLIER_SETTINGS,
    type AccountId
} from "./supplier-config";
import { ACCOUNT_NAMES } from "./suppliers";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many days before the limit the app warns. */
export const INACTIVITY_WARNING_DAYS = 30;

/** When each account's API last answered, as ISO time. */
export type LastConnections = Partial<Record<AccountId, string>>;

export interface Inactivity {
    limitDays: number;
    /** Whole days since the last connection. */
    daysSince: number;
    /** Days until the supplier disables access; 0 when it may have. */
    daysLeft: number;
    /** Less than INACTIVITY_WARNING_DAYS are left. */
    warn: boolean;
}

/** Null for an account without a limit, or that hasn't answered yet. */
export function inactivityOf(
    account: AccountId,
    lastConnected: string | undefined,
    now: number
): Inactivity | null {
    const limitDays = SUPPLIER_SETTINGS[account].inactivityLimitDays;
    const at = lastConnected ? Date.parse(lastConnected) : Number.NaN;
    if (!limitDays || Number.isNaN(at)) {
        return null;
    }
    const elapsed = Math.max(0, now - at);
    return {
        limitDays,
        daysSince: Math.floor(elapsed / DAY_MS),
        daysLeft: Math.max(
            0,
            Math.ceil((limitDays * DAY_MS - elapsed) / DAY_MS)
        ),
        warn: elapsed > (limitDays - INACTIVITY_WARNING_DAYS) * DAY_MS
    };
}

function days(count: number): string {
    return `${count} day${count === 1 ? "" : "s"}`;
}

/** The line in the account's settings; null for an account without a
 *  limit. */
export function connectionStatus(
    account: AccountId,
    lastConnected: string | undefined,
    now: number
): string | null {
    const limitDays = SUPPLIER_SETTINGS[account].inactivityLimitDays;
    if (!limitDays) {
        return null;
    }
    const name = ACCOUNT_NAMES[account];
    const rule = `${name} disables API access after ${limitDays} days without use`;
    const inactivity = inactivityOf(account, lastConnected, now);
    if (!inactivity || !lastConnected) {
        return `Last connection: none yet. ${rule}; collecting or Test connection counts as use.`;
    }
    return (
        `Last connection: ${formatDateTime(lastConnected)}. ${rule}: ` +
        (inactivity.daysLeft > 0
            ? `${days(inactivity.daysLeft)} left.`
            : "it may be disabled already.")
    );
}

/** What to tell when the app starts: one paragraph per account that is
 *  close to its limit, or past it. */
export function inactivityWarnings(
    lastConnections: LastConnections,
    now: number
): string[] {
    return ACCOUNT_IDS.flatMap(account => {
        const last = lastConnections[account];
        const inactivity = inactivityOf(account, last, now);
        if (!last || !inactivity?.warn) {
            return [];
        }
        const name = ACCOUNT_NAMES[account];
        const { limitDays, daysSince, daysLeft } = inactivity;
        const when =
            daysLeft > 0
                ? `so in ${days(daysLeft)}. To keep it, collect ${name} data or click Test connection in Settings → Suppliers → ${name}.`
                : `so it may be disabled already. Try Test connection in Settings → Suppliers → ${name}.`;
        return [
            `${name}'s API was last used ${days(daysSince)} ago, on ${formatDateTime(last)}. ` +
                `${name} disables API access after ${limitDays} days without use, ${when} ` +
                `If you don't use ${name} any more, remove its key in Settings to stop this reminder.`
        ];
    });
}
