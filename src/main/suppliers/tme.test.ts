import { describe, expect, it } from "vitest";
import { fakeContext } from "./fake-context";
import { tme } from "./tme";
import { AuthError } from "./types";

// Shapes follow TME's v2 OpenAPI examples (developers.tme.eu/openapi.json).
const PRODUCTS: Record<string, unknown> = {
    "1N4007-DIO": {
        symbol: "1N4007-DIO",
        manufacturer: { id: 1, name: "DIOTEC SEMICONDUCTOR" },
        manufacturer_symbols: ["1N4007"],
        description: "Diode: rectifying; THT; 1kV; 1A",
        minimal_amount: 50,
        multiples: 50,
        product_status: []
    },
    "CL21B105KOFNNNE-SAM": {
        symbol: "CL21B105KOFNNNE-SAM",
        manufacturer: { name: "SAMSUNG" },
        manufacturer_symbols: ["CL21B105KOFNNNE"],
        description: "Capacitor: ceramic; MLCC; 1uF",
        minimal_amount: 100,
        multiples: 100,
        product_status: ["AVAILABLE_WHILE_STOCKS_LAST"]
    }
};

const DATA: Record<string, unknown> = {
    "1N4007-DIO": {
        symbol: "1N4007-DIO",
        stock_quantity: 120000,
        prices: {
            elements: [
                { amount: 50, price: 0.0123, special: false },
                { amount: 500, price: 0.0098, special: true }
            ],
            currency: "EUR",
            type: "NET"
        }
    },
    "CL21B105KOFNNNE-SAM": {
        symbol: "CL21B105KOFNNNE-SAM",
        stock_quantity: 0,
        prices: { elements: [], currency: "EUR", type: "GROSS" }
    }
};

function tmeServer(options: { rejectToken?: boolean; invalid?: string } = {}) {
    return (request: { method: string }, url: URL) => {
        if (url.pathname === "/auth/token") {
            return options.rejectToken
                ? {
                      status: 400,
                      body: {
                          error: "invalid_request",
                          error_description: "E_TOKEN_NOT_FOUND"
                      }
                  }
                : {
                      body: {
                          access_token: "access-1",
                          token_type: "Bearer",
                          expires_in: 300
                      }
                  };
        }
        const symbols = url.searchParams.getAll("symbols[]");
        const mpns = url.searchParams.getAll("mpns[]");
        if (
            options.invalid &&
            [...symbols, ...mpns].includes(options.invalid)
        ) {
            return {
                status: 400,
                body: {
                    code: "E_INPUT_PARAMS_VALIDATION_ERROR",
                    error_code: 6,
                    message: "Invalid symbol"
                }
            };
        }
        const elements =
            url.pathname === "/products"
                ? symbols.length > 0
                    ? symbols.map(s => PRODUCTS[s]).filter(Boolean)
                    : Object.values(PRODUCTS).filter(p =>
                          (
                              p as { manufacturer_symbols: string[] }
                          ).manufacturer_symbols.some(m => mpns.includes(m))
                      )
                : symbols.map(s => DATA[s]).filter(Boolean);
        return { body: { status: "OK", data: { elements } } };
    };
}

const SECRETS = { token: "tme-token", appSecret: "tme-secret" };

describe("TME", () => {
    it("looks up symbols, prices and stock", async () => {
        const context = fakeContext("tme", SECRETS, tmeServer());
        const outcomes = await tme.lookup(["1n4007-dio", "NOPE"], context);
        expect(outcomes.get("1N4007-DIO")).toMatchObject({
            status: "found",
            matchedBy: "supplierPartNumber",
            offer: {
                manufacturer: "DIOTEC SEMICONDUCTOR",
                manufacturerPartNumber: "1N4007",
                stockQty: 120000,
                moq: 50,
                orderMultiple: 50,
                priceBreaks: [
                    { qty: 50, unitPrice: 0.0123 },
                    { qty: 500, unitPrice: 0.0098 }
                ],
                currency: "EUR",
                priceKind: "account",
                lifecycle: "active",
                rohs: null,
                notes: ["Includes special prices for your account."]
            }
        });
        expect(outcomes.get("NOPE")).toEqual({ status: "notFound" });

        const token = context.requests[0]!;
        expect(token.headers?.Authorization).toBe(
            `Basic ${Buffer.from("tme-token:tme-secret").toString("base64")}`
        );
        const data = new URL(context.requests.at(-1)!.url);
        expect(data.pathname).toBe("/products/data");
        expect(data.searchParams.getAll("scope[]")).toEqual([
            "prices",
            "stock"
        ]);
        expect(data.searchParams.get("currency")).toBe("EUR");
        expect(data.searchParams.get("country")).toBe("HR");
    });

    it("finds a manufacturer part number and flags gross prices", async () => {
        const context = fakeContext("tme", SECRETS, tmeServer());
        const outcome = (await tme.lookup(["CL21B105KOFNNNE"], context)).get(
            "CL21B105KOFNNNE"
        );
        expect(outcome).toMatchObject({
            status: "found",
            matchedBy: "mpn",
            offer: {
                supplierPartNumber: "CL21B105KOFNNNE-SAM",
                lifecycle: "eol",
                notes: ["Prices include VAT (set in your TME account)."]
            }
        });
    });

    it("skips an invalid symbol without losing the rest of the batch", async () => {
        const context = fakeContext(
            "tme",
            SECRETS,
            tmeServer({ invalid: "BAD_ONE" })
        );
        const outcomes = await tme.lookup(
            ["1N4007-DIO", "BAD_ONE", "CL21B105KOFNNNE-SAM"],
            context
        );
        expect(outcomes.get("BAD_ONE")).toMatchObject({ status: "error" });
        expect(outcomes.get("1N4007-DIO")).toMatchObject({ status: "found" });
        expect(outcomes.get("CL21B105KOFNNNE-SAM")).toMatchObject({
            status: "found"
        });
    });

    it("reports rejected credentials", async () => {
        const context = fakeContext(
            "tme",
            { token: "other", appSecret: "x" },
            tmeServer({ rejectToken: true })
        );
        await expect(
            tme.lookup(["1N4007-DIO"], context)
        ).rejects.toBeInstanceOf(AuthError);
    });
});
