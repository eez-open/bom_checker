import { describe, expect, it } from "vitest";
import { defaultSettings, normalizeOrder, normalizeSettings } from "./settings";
import {
    defaultSupplierConfig,
    secretFields,
    validateSupplierConfig
} from "./supplier-config";

describe("settings", () => {
    it("has defaults for every supplier", () => {
        const settings = defaultSettings();
        expect(settings.general.supplierOrder).toEqual([
            "digikey",
            "mouser",
            "tme"
        ]);
        expect(settings.suppliers.digikey).toMatchObject({
            site: "SI",
            currency: "EUR",
            perMinute: 120,
            perDay: 1000
        });
        expect(settings.suppliers.tme).toMatchObject({
            country: "HR",
            currency: "EUR"
        });
    });

    it("keeps valid values and replaces invalid ones", () => {
        const settings = normalizeSettings({
            general: { supplierOrder: ["tme", "lcsc", "tme"] },
            suppliers: {
                digikey: { site: "DE", perDay: -5, clientSecret: "leak" },
                mouser: "nonsense"
            }
        });
        expect(settings.general.supplierOrder).toEqual([
            "tme",
            "digikey",
            "mouser"
        ]);
        expect(settings.suppliers.digikey.site).toBe("DE");
        expect(settings.suppliers.digikey.perDay).toBe(1000);
        expect(settings.suppliers.digikey).not.toHaveProperty("clientSecret");
        expect(settings.suppliers.mouser).toEqual(
            defaultSupplierConfig("mouser")
        );
    });

    it("survives a file that isn't an object", () => {
        expect(normalizeSettings(null)).toEqual(defaultSettings());
        expect(normalizeOrder("tme")).toEqual(["digikey", "mouser", "tme"]);
    });
});

describe("supplier config", () => {
    it("reports invalid fields", () => {
        expect(
            validateSupplierConfig("tme", {
                ...defaultSupplierConfig("tme"),
                country: "hr",
                minIntervalMs: 1.5,
                currency: "GBP"
            })
        ).toEqual({
            country: "Invalid value.",
            minIntervalMs: "Enter a whole number.",
            currency: "Choose a value."
        });
        expect(
            validateSupplierConfig("mouser", defaultSupplierConfig("mouser"))
        ).toEqual({});
    });

    it("lists the secret fields", () => {
        expect(secretFields("digikey").map(f => f.key)).toEqual([
            "clientId",
            "clientSecret",
            "accountId"
        ]);
        expect(secretFields("tme").map(f => f.key)).toEqual([
            "token",
            "appSecret"
        ]);
    });
});
