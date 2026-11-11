import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { HttpRequest } from "../collection/http";
import { fakeContext, type FakeAnswer } from "./fake-context";
import { checkResponse, lcsc, lcscEncode, signRequest } from "./lcsc";
import { AuthError, QuotaExceededError, ThrottledError } from "./types";

// Shapes follow LCSC's OpenAPI guide (AgentProductPO); it has no examples,
// so the values are made up.
const RP2040 = {
    lcscProductNumber: "C2040",
    manufacturerProductNumber: "RP2040",
    manufacturer: { id: 1213, name: "Raspberry Pi" },
    description: "Microcontroller, dual Cortex-M0+",
    packageType: "Tape & Reel (TR)",
    minimumOrderQuantity: 1,
    incrementQuantity: 1,
    isOnSale: true,
    productDetailURL: "https://www.lcsc.com/product-detail/C2040.html",
    productParameters: { RoHS: "Yes" },
    productPrice: {
        currency: "EUR",
        quantityAvailable: 67840,
        standardPricing: [
            { breakQuantity: 10, unitPrice: 0.92 },
            { breakQuantity: 1, unitPrice: 1.0092 }
        ]
    }
};

const RESISTOR = {
    lcscProductNumber: "C25905",
    manufacturerProductNumber: "0402WGF5101TCE",
    manufacturer: { name: "UNI-ROYAL" },
    minimumOrderQuantity: 100,
    incrementQuantity: 100,
    isOnSale: false,
    productPrice: {
        currency: "EUR",
        quantityAvailable: 1275700,
        standardPricing: [{ breakQuantity: 100, unitPrice: 0.0022 }]
    }
};

const ok = (result: unknown): FakeAnswer => ({
    body: { code: 200, message: "ok", success: true, result }
});

/** Answers like LCSC; checks each request's signature like LCSC does. */
function lcscServer(answer: (url: URL) => FakeAnswer, secret = "test-secret") {
    return (request: HttpRequest, url: URL): FakeAnswer => {
        const headers = request.headers ?? {};
        const signed =
            `key=${headers.key}&nonce=${headers.nonce}&secret=${secret}` +
            `&timestamp=${headers.timestamp}&${url.search.slice(1)}`;
        const expected = createHash("sha256").update(signed).digest("hex");
        if (headers.signature !== expected) {
            return {
                body: { code: 4003, message: "sign error", success: false }
            };
        }
        return answer(url);
    };
}

const SECRETS = { apiKey: "test-key", apiSecret: "test-secret" };

describe("LCSC request signing", () => {
    it("matches LCSC's reference implementation", () => {
        // Computed with the Python script in LCSC's API guide.
        const { query, headers } = signRequest(
            {
                keyword: "LM358 (DR)~!'*",
                limit: "20",
                returnInformation: "all",
                currency: "EUR"
            },
            "test-key",
            "test-secret",
            1_793_000_000_123,
            "0123456789abcdef0123456789abcdef"
        );
        expect(query).toBe(
            "currency=EUR&keyword=LM358+%28DR%29%7E%21%27*&limit=20&returnInformation=all"
        );
        expect(headers).toMatchObject({
            key: "test-key",
            timestamp: "1793000000",
            signature:
                "9caf25514679b11f6dbc4f7ee5270692994976dc83607818245b13805477cb5a"
        });
    });

    it("encodes like Java's URLEncoder", () => {
        expect(lcscEncode("a b/č~*-._")).toBe("a+b%2F%C4%8D%7E*-._");
    });
});

describe("LCSC lookups", () => {
    it("looks up LCSC numbers by product details", async () => {
        const context = fakeContext(
            "lcsc",
            SECRETS,
            lcscServer(url =>
                url.searchParams.get("lcscProductNumber") === "C2040"
                    ? ok(RP2040)
                    : ok(null)
            )
        );
        const outcomes = await lcsc.lookup(["c2040 ", "C999999999"], context);
        expect(outcomes.get("C2040")).toMatchObject({
            status: "found",
            matchedBy: "supplierPartNumber",
            offer: {
                supplierPartNumber: "C2040",
                manufacturer: "Raspberry Pi",
                manufacturerPartNumber: "RP2040",
                packaging: "Tape & Reel (TR)",
                stockQty: 67840,
                moq: 1,
                orderMultiple: 1,
                priceBreaks: [
                    { qty: 1, unitPrice: 1.0092 },
                    { qty: 10, unitPrice: 0.92 }
                ],
                priceKind: "list",
                currency: "EUR",
                lifecycle: "active",
                rohs: "Yes"
            }
        });
        expect(outcomes.get("C999999999")).toEqual({ status: "notFound" });
        const first = new URL(context.requests[0]!.url);
        expect(first.pathname).toBe(
            "/rest/api/agent/product/v1/productdetails"
        );
        expect(first.searchParams.get("currency")).toBe("EUR");
    });

    it("searches for manufacturer part numbers", async () => {
        const context = fakeContext(
            "lcsc",
            SECRETS,
            lcscServer(url =>
                ok({
                    productCount: 2,
                    products:
                        url.searchParams.get("keyword") === "0402WGF5101TCE"
                            ? [RP2040, RESISTOR]
                            : []
                })
            )
        );
        const outcomes = await lcsc.lookup(
            ["0402WGF5101TCE", "NOPE-123"],
            context
        );
        expect(outcomes.get("0402WGF5101TCE")).toMatchObject({
            status: "found",
            matchedBy: "mpn",
            offer: {
                supplierPartNumber: "C25905",
                moq: 100,
                orderMultiple: 100,
                lifecycle: "not-orderable",
                lifecycleRaw: "Not on sale"
            }
        });
        expect(outcomes.get("NOPE-123")).toEqual({ status: "notFound" });
        expect(new URL(context.requests[0]!.url).pathname).toBe(
            "/rest/api/agent/product/v1/keywordsearch"
        );
    });

    it("asks for prices again when they come in another currency", async () => {
        const context = fakeContext(
            "lcsc",
            SECRETS,
            lcscServer(url =>
                url.searchParams.get("returnInformation") === "ProductPricing"
                    ? ok({ productPrice: RP2040.productPrice })
                    : ok({
                          ...RP2040,
                          productPrice: {
                              ...RP2040.productPrice,
                              currency: "USD"
                          }
                      })
            )
        );
        const outcome = (await lcsc.lookup(["C2040"], context)).get("C2040");
        expect(outcome).toMatchObject({
            status: "found",
            offer: { currency: "EUR" }
        });
        expect(context.requests).toHaveLength(2);
    });

    it("reports rejected credentials", async () => {
        const context = fakeContext(
            "lcsc",
            { apiKey: "test-key", apiSecret: "wrong" },
            lcscServer(() => ok(RP2040))
        );
        await expect(lcsc.lookup(["C2040"], context)).rejects.toThrow(
            /LCSC rejected the request: sign error/
        );
    });
});

describe("LCSC addresses", () => {
    async function firstUrl(config: Record<string, string>): Promise<string> {
        const context = fakeContext(
            "lcsc",
            SECRETS,
            lcscServer(() => ok(RP2040))
        );
        context.baseUrl = defaultUrl => defaultUrl;
        Object.assign(context.config, config);
        await lcsc.lookup(["C2040"], context);
        return context.requests[0]!.url;
    }

    it("calls LCSC's production or sandbox server", async () => {
        expect(await firstUrl({})).toMatch(
            /^https:\/\/api\.lcsc\.com\/rest\/api\/agent\/product\/v1\/productdetails\?/
        );
        expect(await firstUrl({ environment: "sandbox" })).toMatch(
            /^https:\/\/sandbox-api\.lcsc\.com\/rest\//
        );
    });

    it("calls the relay in Settings → API address instead", async () => {
        expect(
            await firstUrl({
                apiAddress: "https://example.com/lcsc/",
                environment: "sandbox"
            })
        ).toMatch(
            /^https:\/\/example\.com\/lcsc\/rest\/api\/agent\/product\/v1\/productdetails\?/
        );
    });
});

describe("LCSC answers", () => {
    const headers = new Headers();

    it("explains a network address that isn't registered", () => {
        expect(() => checkResponse(401, headers, null, "details")).toThrow(
            AuthError
        );
        expect(() => checkResponse(401, headers, null, "details")).toThrow(
            /IP addresses registered/
        );
    });

    it("stops at the daily limit and waits at the per-minute limit", () => {
        expect(() => checkResponse(430, headers, null, "search")).toThrow(
            QuotaExceededError
        );
        expect(() =>
            checkResponse(
                200,
                headers,
                { code: 429, success: false, message: "Too many" },
                "search"
            )
        ).toThrow(ThrottledError);
    });

    it("treats a missing product as not found", () => {
        expect(
            checkResponse(
                200,
                headers,
                { code: 404, success: false, message: "Product not found" },
                "details"
            )
        ).toBeNull();
        expect(() =>
            checkResponse(
                200,
                headers,
                { code: 500, success: false, message: "Server busy" },
                "details"
            )
        ).toThrow("LCSC: Server busy");
    });
});
