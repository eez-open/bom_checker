import { describe, expect, it } from "vitest";
import type { HttpRequest } from "../collection/http";
import { digikey } from "./digikey";
import { fakeContext, type FakeAnswer } from "./fake-context";
import { AuthError, QuotaExceededError } from "./types";

// Field names from DigiKey's Product Information v4 OpenAPI file.
function product(
    myPricing: { BreakQuantity: number; UnitPrice: number }[] = []
) {
    return {
        Product: {
            Manufacturer: { Id: 13, Name: "Stackpole Electronics Inc" },
            ManufacturerProductNumber: "RMCF0805FT100K",
            Description: { ProductDescription: "RES 100K OHM 1% 1/8W 0805" },
            QuantityAvailable: 900000,
            ProductStatus: { Id: 0, Status: "Active" },
            Classifications: { RohsStatus: "ROHS3 Compliant" },
            ProductUrl: "https://www.digikey.si/en/products/detail/x",
            DatasheetUrl: "https://example.com/ds.pdf",
            ProductVariations: [
                {
                    DigiKeyProductNumber: "RMCF0805FT100KCT-ND",
                    PackageType: { Id: 2, Name: "Cut Tape (CT)" },
                    StandardPricing: [
                        {
                            BreakQuantity: 10,
                            UnitPrice: 0.019,
                            TotalPrice: 0.19
                        },
                        { BreakQuantity: 1, UnitPrice: 0.1, TotalPrice: 0.1 }
                    ],
                    MyPricing: myPricing,
                    MinimumOrderQuantity: 1,
                    QuantityAvailableforPackageType: 400000
                },
                {
                    DigiKeyProductNumber: "RMCF0805FT100KTR-ND",
                    PackageType: { Id: 1, Name: "Tape & Reel (TR)" },
                    StandardPricing: [
                        { BreakQuantity: 5000, UnitPrice: 0.0028 }
                    ],
                    MinimumOrderQuantity: 5000,
                    QuantityAvailableforPackageType: 500000
                }
            ]
        },
        SearchLocaleUsed: { Site: "SI", Language: "en", Currency: "EUR" },
        AccountIdUsed: 0,
        CustomerIdUsed: 0
    };
}

/** A product of the keyword search, as DigiKey lists Molex connectors. */
function connector(manufacturerPartNumber: string, digikeyNumber: string) {
    return {
        Manufacturer: { Id: 23, Name: "Molex" },
        ManufacturerProductNumber: manufacturerPartNumber,
        Description: { ProductDescription: "CONN RCPT HSG 3POS 2.54MM" },
        QuantityAvailable: 5000,
        ProductStatus: { Id: 0, Status: "Active" },
        ProductVariations: [
            {
                DigiKeyProductNumber: digikeyNumber,
                PackageType: { Id: 3, Name: "Bulk" },
                StandardPricing: [{ BreakQuantity: 1, UnitPrice: 0.2 }],
                MyPricing: [],
                MinimumOrderQuantity: 1,
                QuantityAvailableforPackageType: 5000
            }
        ]
    };
}

function keywordAnswer(products: unknown[]): FakeAnswer {
    return {
        body: {
            Products: products,
            ProductsCount: products.length,
            ExactMatches: [],
            SearchLocaleUsed: { Site: "SI", Language: "en", Currency: "EUR" }
        }
    };
}

const NOT_FOUND: FakeAnswer = {
    status: 404,
    body: { title: "Not Found", status: 404 }
};

function digikeyServer(
    detail: (partNumber: string) => FakeAnswer,
    keyword: (keywords: string) => FakeAnswer = () => keywordAnswer([])
) {
    return (request: HttpRequest, url: URL) => {
        if (url.pathname === "/v1/oauth2/token") {
            return {
                body: {
                    access_token: "dk-token",
                    expires_in: 599,
                    token_type: "Bearer"
                }
            };
        }
        if (url.pathname === "/products/v4/search/keyword") {
            const body = JSON.parse(request.body ?? "{}") as {
                Keywords?: string;
            };
            return keyword(body.Keywords ?? "");
        }
        const match = /\/products\/v4\/search\/(.+)\/productdetails$/.exec(
            url.pathname
        );
        return detail(decodeURIComponent(match?.[1] ?? ""));
    };
}

const SECRETS = {
    clientId: "id-1",
    clientSecret: "secret-1",
    accountId: "12345"
};

describe("DigiKey", () => {
    it("picks the requested packaging and uses the account's prices", async () => {
        const context = fakeContext(
            "digikey",
            SECRETS,
            digikeyServer(() => ({
                body: product([{ BreakQuantity: 1, UnitPrice: 0.08 }]),
                headers: { "X-RateLimit-Remaining": "987" }
            }))
        );
        const outcome = (
            await digikey.lookup(["rmcf0805ft100kct-nd"], context)
        ).get("RMCF0805FT100KCT-ND");
        expect(outcome).toMatchObject({
            status: "found",
            matchedBy: "supplierPartNumber",
            offer: {
                supplierPartNumber: "RMCF0805FT100KCT-ND",
                packaging: "Cut Tape (CT)",
                stockQty: 400000,
                moq: 1,
                priceBreaks: [{ qty: 1, unitPrice: 0.08 }],
                priceKind: "account",
                currency: "EUR",
                lifecycle: "active",
                rohs: "ROHS3 Compliant"
            }
        });
        expect(context.remaining).toEqual([987]);
        const request = context.requests.at(-1)!;
        expect(request.headers).toMatchObject({
            Authorization: "Bearer dk-token",
            "X-DIGIKEY-Client-Id": "id-1",
            "X-DIGIKEY-Locale-Site": "SI",
            "X-DIGIKEY-Locale-Currency": "EUR",
            "X-DIGIKEY-Account-Id": "12345"
        });
    });

    it("mentions other packagings that have stock", async () => {
        // As DigiKey answered for TDK B32620A6222J289: no cut tape in
        // stock, 1,930 in a box of 2,000.
        const body = product();
        body.Product.ProductVariations = [
            {
                ...body.Product.ProductVariations[0]!,
                DigiKeyProductNumber: "495-4874-1-ND",
                QuantityAvailableforPackageType: 0
            },
            {
                ...body.Product.ProductVariations[1]!,
                DigiKeyProductNumber: "495-4874-3-ND",
                PackageType: { Id: 4, Name: "Tape & Box (TB)" },
                MinimumOrderQuantity: 2000,
                QuantityAvailableforPackageType: 1930
            }
        ];
        const context = fakeContext(
            "digikey",
            SECRETS,
            digikeyServer(() => ({ body }))
        );
        const outcome = (await digikey.lookup(["495-4874-1-ND"], context)).get(
            "495-4874-1-ND"
        );
        expect(outcome).toMatchObject({
            status: "found",
            offer: {
                stockQty: 0,
                notes: [
                    "Other packaging: 495-4874-3-ND (Tape & Box (TB)): 1930 in stock, MOQ 2000."
                ]
            }
        });
    });

    it("falls back to list prices and asks which packaging for a manufacturer number", async () => {
        const context = fakeContext(
            "digikey",
            SECRETS,
            digikeyServer(() => ({ body: product() }))
        );
        const outcome = (await digikey.lookup(["RMCF0805FT100K"], context)).get(
            "RMCF0805FT100K"
        );
        expect(outcome).toMatchObject({ status: "ambiguous" });
        if (outcome?.status === "ambiguous") {
            expect(outcome.candidates.map(c => c.supplierPartNumber)).toEqual([
                "RMCF0805FT100KCT-ND",
                "RMCF0805FT100KTR-ND"
            ]);
            expect(outcome.candidates[0]?.priceKind).toBe("list");
            expect(outcome.candidates[0]?.priceBreaks[0]).toEqual({
                qty: 1,
                unitPrice: 0.1
            });
        }
    });

    it("encodes part numbers with a slash", async () => {
        const context = fakeContext(
            "digikey",
            SECRETS,
            digikeyServer(() => NOT_FOUND)
        );
        const outcome = (
            await digikey.lookup(["MCP2221A-I/ML-ND"], context)
        ).get("MCP2221A-I/ML-ND");
        expect(outcome).toEqual({ status: "notFound" });
        expect(context.requests.map(request => request.url)).toContain(
            "https://api.test/products/v4/search/MCP2221A-I%2FML-ND/productdetails"
        );
    });

    it("searches by keyword for a part listed under another form of its number", async () => {
        // As DigiKey answered for Molex 22-01-3037: not found as such; its
        // keyword search finds 0022013037 and similar housings.
        const context = fakeContext(
            "digikey",
            SECRETS,
            digikeyServer(
                () => NOT_FOUND,
                () =>
                    keywordAnswer([
                        connector("0022013027", "900-0022013027-ND"),
                        connector("0022013037", "900-0022013037-ND")
                    ])
            )
        );
        const outcome = (await digikey.lookup(["22-01-3037"], context)).get(
            "22-01-3037"
        );
        expect(outcome).toMatchObject({
            status: "found",
            matchedBy: "mpn",
            offer: {
                supplierPartNumber: "900-0022013037-ND",
                manufacturerPartNumber: "0022013037",
                currency: "EUR"
            }
        });
        const search = context.requests.at(-1)!;
        expect(search).toMatchObject({
            method: "POST",
            url: "https://api.test/products/v4/search/keyword",
            headers: {
                Authorization: "Bearer dk-token",
                "Content-Type": "application/json",
                "X-DIGIKEY-Account-Id": "12345"
            }
        });
        expect(JSON.parse(search.body!)).toEqual({
            Keywords: "22-01-3037",
            Limit: 10,
            Offset: 0
        });
    });

    it("lets the user choose among the keyword search's products", async () => {
        const context = fakeContext(
            "digikey",
            SECRETS,
            digikeyServer(
                () => NOT_FOUND,
                keywords =>
                    keywords === "22-01-3099"
                        ? keywordAnswer([
                              connector("0022013097", "900-0022013097-ND"),
                              connector("0022013098", "900-0022013098-ND")
                          ])
                        : NOT_FOUND
            )
        );
        const outcome = (await digikey.lookup(["22-01-3099"], context)).get(
            "22-01-3099"
        );
        expect(outcome).toMatchObject({ status: "ambiguous" });
        if (outcome?.status === "ambiguous") {
            expect(outcome.candidates.map(c => c.supplierPartNumber)).toEqual([
                "900-0022013097-ND",
                "900-0022013098-ND"
            ]);
        }
        expect(
            (await digikey.lookup(["NOTHING-LIKE-IT"], context)).get(
                "NOTHING-LIKE-IT"
            )
        ).toEqual({ status: "notFound" });
    });

    it("stops at the daily limit and on rejected credentials", async () => {
        const daily = fakeContext(
            "digikey",
            SECRETS,
            digikeyServer(() => ({
                status: 429,
                body: {
                    ErrorResponseVersion: "3.0.0.0",
                    StatusCode: 429,
                    ErrorMessage: "Daily Ratelimit exceeded"
                }
            }))
        );
        await expect(digikey.lookup(["X-ND"], daily)).rejects.toBeInstanceOf(
            QuotaExceededError
        );

        const rejected = fakeContext(
            "digikey",
            { clientId: "bad", clientSecret: "bad" },
            (_r, url) =>
                url.pathname === "/v1/oauth2/token"
                    ? {
                          status: 401,
                          body: { ErrorMessage: "Invalid clientId" }
                      }
                    : { status: 200 }
        );
        await expect(digikey.lookup(["X-ND"], rejected)).rejects.toBeInstanceOf(
            AuthError
        );
    });
});
