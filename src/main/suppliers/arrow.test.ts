import { describe, expect, it } from "vitest";
import { arrowLifecycle } from "../../shared/lifecycle";
import { defaultSupplierConfig } from "../../shared/supplier-config";
import { arrowPlugin, parseArrowResponse } from "./arrow";
import { fakeContext } from "./fake-context";
import { AuthError, SupplierError } from "./types";

// Shapes follow the example responses in Arrow's documentation of the
// Pricing & Availability API v4 (search by token and by list).

function sourcePart(
    stock: number,
    prices: [number, number][],
    extra: Record<string, unknown> = {}
) {
    return {
        packSize: 1,
        minimumOrderQuantity: 1,
        sourcePartId: "1",
        Prices: {
            resaleList: prices.map(([minQty, price]) => ({
                displayPrice: String(price),
                price,
                minQty,
                maxQty: 999999999
            }))
        },
        Availability: [
            {
                fohQty: stock,
                availabilityCd: stock > 0 ? "INSTK" : "NOSTK",
                availabilityMessage: stock > 0 ? "In Stock" : "No Stock",
                pipeline: []
            }
        ],
        resources: [
            { type: "detail", uri: "https://www.arrow.com/en/products/bav99" }
        ],
        inStock: stock > 0,
        shipsFrom: "Germany",
        shipsIn: "Ships in 1 day ",
        isNcnr: false,
        containerType: "Cut Tape",
        ...extra
    };
}

/** BAV99 from Nexperia: two packagings in Europe, one in North America. */
const BAV99 = {
    itemId: 1,
    partNum: "BAV99,215",
    manufacturer: { mfrCd: "NXP", mfrName: "Nexperia" },
    desc: "Diode Switching 100V 0.215A",
    status: "Active",
    EnvData: {
        compliance: [
            { displayLabel: "eurohs", displayValue: "Compliant" },
            { displayLabel: "cnrohs", displayValue: "Compliant" }
        ]
    },
    InvOrg: {
        webSites: [
            {
                code: "Arrow",
                name: "Arrow",
                sources: [
                    {
                        currency: "EUR",
                        sourceCd: "EUROPE",
                        displayName: "Europe",
                        sourceParts: [
                            sourcePart(1200, [
                                [10, 0.05],
                                [1, 0.08]
                            ]),
                            sourcePart(30000, [[3000, 0.02]], {
                                packSize: 3000,
                                minimumOrderQuantity: 3000,
                                containerType: "Reel"
                            })
                        ]
                    },
                    {
                        currency: "USD",
                        sourceCd: "ACNA",
                        displayName: "Americas",
                        sourceParts: [sourcePart(500, [[1, 0.09]])]
                    }
                ]
            }
        ]
    }
};

/** Only on Verical. */
const RARE = {
    itemId: 2,
    partNum: "RARE-1",
    manufacturer: { mfrName: "Obscure" },
    desc: "",
    status: "Obsolete",
    InvOrg: {
        webSites: [
            {
                code: "Verical.com",
                sources: [
                    {
                        currency: "USD",
                        sourceCd: "VERICAL",
                        sourceParts: [sourcePart(5, [[1, 12.5]])]
                    }
                ]
            }
        ]
    }
};

function answer(parts: unknown[], success = true, returnMsg = "") {
    return {
        itemserviceresult: {
            serviceMetaData: [{ version: "4.0.0" }],
            transactionArea: [
                {
                    response: {
                        returnCode: success ? "0" : "1",
                        returnMsg,
                        success
                    },
                    responseSequence: { totalItems: parts.length }
                }
            ],
            data: [{ PartList: parts }]
        }
    };
}

describe("Arrow responses (#62)", () => {
    it("takes the offer of the supplier's inventory source", () => {
        const outcomes = parseArrowResponse(
            ["bav99,215", "RARE-1", "NOPE-1"],
            "EUROPE",
            200,
            answer([BAV99, RARE])
        );
        // The packaging with the most stock; the other one in the notes.
        expect(outcomes.get("BAV99,215")).toMatchObject({
            status: "found",
            matchedBy: "supplierPartNumber",
            offer: {
                supplierPartNumber: "BAV99,215",
                manufacturer: "Nexperia",
                manufacturerPartNumber: "BAV99,215",
                packaging: "Reel",
                stockQty: 30000,
                moq: 3000,
                orderMultiple: 3000,
                priceBreaks: [{ qty: 3000, unitPrice: 0.02 }],
                priceKind: "list",
                currency: "EUR",
                lifecycle: "active",
                lifecycleRaw: "Active",
                rohs: "EU RoHS: Compliant",
                productUrl: "https://www.arrow.com/en/products/bav99",
                notes: [
                    "Ships from Germany, Ships in 1 day",
                    "Also: Nexperia, Cut Tape, 1,200 in stock, MOQ 1"
                ]
            }
        });
        // Not in Europe's stock.
        expect(outcomes.get("RARE-1")).toEqual({ status: "notFound" });
        expect(outcomes.get("NOPE-1")).toEqual({ status: "notFound" });
    });

    it("gives each source its own offer, with its currency", () => {
        const acna = parseArrowResponse(
            ["BAV99,215"],
            "ACNA",
            200,
            answer([BAV99])
        ).get("BAV99,215");
        expect(acna).toMatchObject({
            status: "found",
            offer: {
                stockQty: 500,
                currency: "USD",
                priceBreaks: [{ qty: 1, unitPrice: 0.09 }]
            }
        });
        const verical = parseArrowResponse(
            ["RARE-1"],
            "VERICAL",
            200,
            answer([RARE])
        ).get("RARE-1");
        expect(verical).toMatchObject({
            status: "found",
            offer: { stockQty: 5, lifecycle: "obsolete", rohs: null }
        });
    });

    it("matches part numbers written in another form", () => {
        const outcomes = parseArrowResponse(
            ["BAV99215"],
            "EUROPE",
            200,
            answer([BAV99])
        );
        expect(outcomes.get("BAV99215")).toMatchObject({ status: "found" });
    });

    it("reports rejected credentials and other errors", () => {
        expect(() =>
            parseArrowResponse(
                ["BAV99"],
                "EUROPE",
                200,
                answer([], false, "Invalid login or API key")
            )
        ).toThrow(AuthError);
        expect(() => parseArrowResponse(["BAV99"], "EUROPE", 401, {})).toThrow(
            AuthError
        );
        expect(() =>
            parseArrowResponse(
                ["BAV99"],
                "EUROPE",
                200,
                answer([], false, "Internal problem")
            )
        ).toThrow("Arrow: Internal problem");
        expect(() =>
            parseArrowResponse(["BAV99"], "EUROPE", 200, "<html>")
        ).toThrow(SupplierError);
    });

    it("searches the batch as a list, with the login and the currency", async () => {
        const context = fakeContext(
            "arrow-europe",
            { login: "me", apiKey: "secret key" },
            () => ({ body: answer([BAV99]) })
        );
        const outcomes = await arrowPlugin("arrow-europe").lookup(
            ["BAV99,215", "OTHER"],
            context
        );
        expect(outcomes.get("BAV99,215")?.status).toBe("found");
        const url = new URL(context.requests[0]!.url);
        expect(url.pathname).toBe("/itemservice/v4/en/search/list");
        expect(url.searchParams.get("utm_currency")).toBe("EUR");
        const request = JSON.parse(url.searchParams.get("req")!) as {
            request: Record<string, unknown>;
        };
        expect(request.request).toMatchObject({
            login: "me",
            apikey: "secret key",
            useExact: true,
            parts: [{ partNum: "BAV99,215" }, { partNum: "OTHER" }]
        });
        expect(request.request.remoteIp).toEqual(expect.any(String));
    });

    it("takes the number of part numbers per request from the settings", () => {
        const plugin = arrowPlugin("arrow-asia");
        const config = defaultSupplierConfig("arrow");
        expect(plugin.batchSizeFor?.(config)).toBe(100);
        expect(
            plugin.batchSizeFor?.({ ...config, partsPerRequest: "1000" })
        ).toBe(1000);
    });

    it("maps lifecycle texts", () => {
        expect(arrowLifecycle("Active")).toBe("active");
        expect(arrowLifecycle("Not Recommended for New Designs")).toBe("nrnd");
        expect(arrowLifecycle("Last Time Buy")).toBe("eol");
        expect(arrowLifecycle("Obsolete")).toBe("obsolete");
        expect(arrowLifecycle("New Product")).toBe("new");
        expect(arrowLifecycle("")).toBeNull();
        expect(arrowLifecycle("Something else")).toBeNull();
    });

    it("reads list searches' answers, one per part number asked for", () => {
        // As Arrow answers list searches (seen in live responses): the
        // parts in data[0].resultList[], with the part number asked for,
        // written Arrow's way.
        const varistor = {
            ...BAV99,
            partNum: "ERZ-E14A431",
            manufacturer: { mfrCd: "PANASONI", mfrName: "Panasonic" },
            status: "LTB",
            InvOrg: {
                webSites: [
                    {
                        code: "arrow.com",
                        name: "arrow.com",
                        sources: [
                            {
                                currency: "EUR",
                                sourceCd: "EUROPE",
                                sourceParts: [
                                    // Stock, but no prices.
                                    {
                                        ...sourcePart(5000, []),
                                        Prices: undefined,
                                        packSize: 1000,
                                        minimumOrderQuantity: 1000,
                                        Availability: [
                                            {
                                                fohQty: 5000,
                                                availabilityCd: "QUOTE",
                                                availabilityMessage:
                                                    "Call For Quote"
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                currency: "EUR",
                                sourceCd: "ACNA",
                                sourceParts: [sourcePart(300, [[1, 0.9]])]
                            }
                        ]
                    }
                ]
            }
        };
        const body = {
            itemserviceresult: {
                transactionArea: [
                    {
                        response: {
                            returnCode: "0",
                            returnMsg: "",
                            success: true
                        }
                    }
                ],
                data: [
                    {
                        partsRequested: 3,
                        partsFound: 2,
                        partsNotFound: 1,
                        partsError: 0,
                        resultList: [
                            {
                                resources: [],
                                PartList: [varistor],
                                requestedPartNum: "ERZE14A431",
                                numberFound: 1
                            },
                            {
                                resources: [],
                                PartList: [RARE],
                                requestedPartNum: "RARE-1",
                                numberFound: 1
                            }
                        ]
                    }
                ]
            }
        };
        const europe = parseArrowResponse(
            ["ERZ-E14A431", "RARE-1", "NOPE-1"],
            "EUROPE",
            200,
            body
        );
        expect(europe.get("ERZ-E14A431")).toMatchObject({
            status: "found",
            offer: {
                supplierPartNumber: "ERZ-E14A431",
                manufacturer: "Panasonic",
                stockQty: 5000,
                moq: 1000,
                priceBreaks: [],
                lifecycle: "eol",
                notes: [
                    "No price: Call For Quote",
                    "Ships from Germany, Ships in 1 day"
                ]
            }
        });
        // Only on Verical, and not answered at all.
        expect(europe.get("RARE-1")).toEqual({ status: "notFound" });
        expect(europe.get("NOPE-1")).toEqual({ status: "notFound" });
        expect(
            parseArrowResponse(["ERZE14A431"], "ACNA", 200, body).get(
                "ERZE14A431"
            )
        ).toMatchObject({
            status: "found",
            offer: { stockQty: 300, priceBreaks: [{ qty: 1, unitPrice: 0.9 }] }
        });
        expect(
            parseArrowResponse(["RARE-1"], "VERICAL", 200, body).get("RARE-1")
        ).toMatchObject({ status: "found", offer: { stockQty: 5 } });
    });

    it("prefers a packaging with prices to one with more stock", () => {
        const quoteOnly = {
            ...sourcePart(90000, []),
            containerType: "Reel"
        };
        const offer = parseArrowResponse(
            ["BAV99,215"],
            "EUROPE",
            200,
            answer([
                {
                    ...BAV99,
                    InvOrg: {
                        webSites: [
                            {
                                sources: [
                                    {
                                        currency: "EUR",
                                        sourceCd: "EUROPE",
                                        sourceParts: [
                                            quoteOnly,
                                            sourcePart(10, [[1, 0.1]])
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                }
            ])
        ).get("BAV99,215");
        expect(offer).toMatchObject({
            status: "found",
            offer: { stockQty: 10, packaging: "Cut Tape" }
        });
    });
});
