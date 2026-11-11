import { describe, expect, it } from "vitest";
import { formatDateTime } from "./collection";
import {
    connectionStatus,
    inactivityOf,
    inactivityWarnings
} from "./inactivity";

const DAY = 24 * 60 * 60 * 1000;
const LAST = "2026-05-01T08:00:00.000Z";
const after = (days: number) => Date.parse(LAST) + days * DAY;

describe("inactivity (#82)", () => {
    it("counts the days since LCSC last answered and the days left", () => {
        expect(inactivityOf("lcsc", LAST, after(0))).toEqual({
            limitDays: 180,
            daysSince: 0,
            daysLeft: 180,
            warn: false
        });
        expect(inactivityOf("lcsc", LAST, after(150))).toMatchObject({
            daysSince: 150,
            daysLeft: 30,
            warn: false
        });
        // More than 150 days.
        expect(inactivityOf("lcsc", LAST, after(150.5))).toMatchObject({
            daysSince: 150,
            daysLeft: 30,
            warn: true
        });
        expect(inactivityOf("lcsc", LAST, after(200))).toMatchObject({
            daysLeft: 0,
            warn: true
        });
    });

    it("applies only to suppliers with a limit that have answered", () => {
        expect(inactivityOf("mouser", LAST, after(400))).toBeNull();
        expect(inactivityOf("lcsc", undefined, after(400))).toBeNull();
    });

    it("says in LCSC's settings when it last answered", () => {
        expect(connectionStatus("lcsc", LAST, after(10))).toBe(
            `Last connection: ${formatDateTime(LAST)}. LCSC disables API access after 180 days without use: 170 days left.`
        );
        expect(connectionStatus("lcsc", LAST, after(181))).toBe(
            `Last connection: ${formatDateTime(LAST)}. LCSC disables API access after 180 days without use: it may be disabled already.`
        );
        expect(connectionStatus("lcsc", undefined, after(0))).toBe(
            "Last connection: none yet. LCSC disables API access after 180 days without use; collecting or Test connection counts as use."
        );
        expect(connectionStatus("mouser", LAST, after(0))).toBeNull();
    });

    it("warns when the app starts, 30 days before the limit", () => {
        expect(inactivityWarnings({ lcsc: LAST }, after(150))).toEqual([]);
        expect(inactivityWarnings({ lcsc: LAST }, after(160))).toEqual([
            `LCSC's API was last used 160 days ago, on ${formatDateTime(LAST)}. ` +
                "LCSC disables API access after 180 days without use, so in 20 days. " +
                "To keep it, collect LCSC data or click Test connection in Settings → Suppliers → LCSC. " +
                "If you don't use LCSC any more, remove its key in Settings to stop this reminder."
        ]);
        expect(inactivityWarnings({ lcsc: LAST }, after(190))[0]).toContain(
            "so it may be disabled already."
        );
        expect(inactivityWarnings({ mouser: LAST }, after(400))).toEqual([]);
        expect(inactivityWarnings({}, after(400))).toEqual([]);
    });
});
