import { describe, expect, it } from "vitest";
import { SUPPLIER_IDS } from "./model";
import { defaultSettings, normalizeOrder, normalizeSettings } from "./settings";
import {
    arrowSources,
    defaultSupplierConfig,
    normalizeSupplierConfig,
    secretFields,
    validateSupplierConfig
} from "./supplier-config";

describe("settings", () => {
    it("has defaults for every supplier", () => {
        const settings = defaultSettings();
        expect(settings.general.supplierOrder).toEqual([...SUPPLIER_IDS]);
        expect(settings.general.decimalSeparator).toBe("system");
        // Arrow's inventory sources share Arrow's settings (#62).
        expect(settings.suppliers.arrow).toMatchObject({
            sources: "EUROPE",
            currency: "EUR",
            partsPerRequest: "100"
        });
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
        expect(settings.suppliers.lcsc).toMatchObject({
            currency: "EUR",
            environment: "production",
            perMinute: 60,
            perDay: 1000
        });
    });

    it("keeps valid values and replaces invalid ones", () => {
        const settings = normalizeSettings({
            general: {
                supplierOrder: ["tme", "farnell", "tme"],
                decimalSeparator: "dot"
            },
            suppliers: {
                digikey: { site: "DE", perDay: -5, clientSecret: "leak" },
                mouser: "nonsense"
            }
        });
        expect(settings.general.supplierOrder).toEqual([
            "tme",
            ...SUPPLIER_IDS.filter(id => id !== "tme")
        ]);
        expect(settings.general.decimalSeparator).toBe("system");
        expect(
            normalizeSettings({ general: { decimalSeparator: "comma" } })
                .general.decimalSeparator
        ).toBe("comma");
        expect(settings.suppliers.digikey.site).toBe("DE");
        expect(settings.suppliers.digikey.perDay).toBe(1000);
        expect(settings.suppliers.digikey).not.toHaveProperty("clientSecret");
        expect(settings.suppliers.mouser).toEqual(
            defaultSupplierConfig("mouser")
        );
    });

    it("survives a file that isn't an object", () => {
        expect(normalizeSettings(null)).toEqual(defaultSettings());
        expect(normalizeOrder("tme")).toEqual([...SUPPLIER_IDS]);
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

describe("Arrow's settings (#62)", () => {
    it("choose several inventory sources", () => {
        const config = normalizeSupplierConfig("arrow", {
            sources: "ASIA,EUROPE"
        });
        expect(config.sources).toBe("ASIA,EUROPE");
        // In Arrow's order.
        expect(arrowSources(config)).toEqual(["EUROPE", "ASIA"]);
        expect(
            validateSupplierConfig("arrow", { ...config, sources: "" })
        ).toMatchObject({ sources: "Choose at least one." });
        expect(
            validateSupplierConfig("arrow", { ...config, sources: "MARS" })
        ).toMatchObject({ sources: "Choose at least one." });
        expect(
            normalizeSupplierConfig("arrow", { sources: "MARS" }).sources
        ).toBe("EUROPE");
        expect(secretFields("arrow").map(field => field.key)).toEqual([
            "login",
            "apiKey"
        ]);
    });
});
