// A local stand-in for the supplier APIs, so end-to-end tests
// can collect without network access or real keys. The app is pointed at it
// with EEZ_BOM_CHECKER_API_URLS. Responses follow the real APIs' shapes.

import { createHash } from "node:crypto";
import {
    createServer,
    type IncomingMessage,
    type ServerResponse
} from "node:http";
import type { AddressInfo } from "node:net";

export const FAKE_CREDENTIALS = {
    digikey: { clientId: "dk-client", clientSecret: "dk-secret" },
    mouser: { apiKey: "mouser-key" },
    tme: { token: "tme-token", appSecret: "tme-secret" },
    lcsc: { apiKey: "lcsc-key", apiSecret: "lcsc-secret" }
};

/** A Mouser part number that triggers the daily limit once. */
export const MOUSER_LIMIT_ONCE = "LIMIT-NOW";

const MOUSER_PARTS: Record<string, unknown> = {
    "595-TPS54331DDA": {
        MouserPartNumber: "595-TPS54331DDA",
        Manufacturer: "Texas Instruments",
        ManufacturerPartNumber: "TPS54331DDA",
        Description: "Switching Voltage Regulators",
        AvailabilityInStock: "1027",
        Min: "1",
        Mult: "1",
        LifecycleStatus: null,
        ROHSStatus: "RoHS Compliant",
        PriceBreaks: [{ Quantity: 1, Price: "2,10 €", Currency: "EUR" }],
        ProductDetailUrl: "https://hr.mouser.com/ProductDetail/x"
    },
    "FAKE-LOWSTOCK": {
        MouserPartNumber: "FAKE-LOWSTOCK",
        Manufacturer: "Yageo",
        ManufacturerPartNumber: "CC0603KRX7R9BB104",
        Description: "MLCC 100nF",
        AvailabilityInStock: "10",
        Min: "1",
        Mult: "1",
        ROHSStatus: "RoHS Compliant",
        PriceBreaks: [{ Quantity: 1, Price: "1,00 €", Currency: "EUR" }]
    }
};

const RESISTOR = {
    Manufacturer: { Name: "Stackpole Electronics Inc" },
    ManufacturerProductNumber: "RMCF0805FT100K",
    Description: { ProductDescription: "RES 100K OHM 1% 1/8W 0805" },
    ProductStatus: { Status: "Active" },
    Classifications: { RohsStatus: "ROHS3 Compliant" },
    ProductVariations: [
        {
            DigiKeyProductNumber: "RMCF0805FT100KCT-ND",
            PackageType: { Name: "Cut Tape (CT)" },
            StandardPricing: [{ BreakQuantity: 1, UnitPrice: 0.1 }],
            MyPricing: [{ BreakQuantity: 1, UnitPrice: 0.08 }],
            MinimumOrderQuantity: 1,
            QuantityAvailableforPackageType: 400000
        },
        {
            DigiKeyProductNumber: "RMCF0805FT100KTR-ND",
            PackageType: { Name: "Tape & Reel (TR)" },
            StandardPricing: [{ BreakQuantity: 5000, UnitPrice: 0.004 }],
            MinimumOrderQuantity: 5000,
            QuantityAvailableforPackageType: 500000
        }
    ]
};

/** DigiKey products by part number; the manufacturer number matches both
 *  packagings, so it is ambiguous. */
const DIGIKEY_PRODUCTS: Record<string, unknown> = {
    "RMCF0805FT100KCT-ND": RESISTOR,
    RMCF0805FT100K: RESISTOR,
    "FAKE-PLENTY-ND": {
        Manufacturer: { Name: "Yageo" },
        ManufacturerProductNumber: "CC0603KRX7R9BB104",
        Description: { ProductDescription: "CAP CER 0.1UF 50V X7R 0603" },
        ProductStatus: { Status: "Not For New Designs" },
        Classifications: { RohsStatus: "ROHS3 Compliant" },
        ProductVariations: [
            {
                DigiKeyProductNumber: "FAKE-PLENTY-ND",
                PackageType: { Name: "Cut Tape (CT)" },
                StandardPricing: [{ BreakQuantity: 1, UnitPrice: 1.2 }],
                MinimumOrderQuantity: 1,
                QuantityAvailableforPackageType: 1000
            }
        ]
    }
};

function lcscProduct(
    lcscProductNumber: string,
    manufacturer: string,
    manufacturerProductNumber: string,
    stock: number,
    unitPrice: number
) {
    return {
        lcscProductNumber,
        manufacturer: { name: manufacturer },
        manufacturerProductNumber,
        description: `${manufacturer} ${manufacturerProductNumber}`,
        minimumOrderQuantity: 1,
        incrementQuantity: 1,
        isOnSale: true,
        productPrice: {
            currency: "EUR",
            quantityAvailable: stock,
            standardPricing: [{ breakQuantity: 1, unitPrice }]
        }
    };
}

/** LCSC products by LCSC number. */
const LCSC_PRODUCTS: Record<string, unknown> = {
    C2040: lcscProduct("C2040", "Raspberry Pi", "RP2040", 67840, 1.01),
    C81598: lcscProduct("C81598", "MDD", "1N4007", 500000, 0.009),
    C9865: lcscProduct("C9865", "Texas Instruments", "TPS54331DDA", 3000, 0.95)
};

/** Checks the signature as LCSC describes it in its API guide. */
function lcscSignatureOk(request: IncomingMessage, url: URL): boolean {
    const header = (name: string) => String(request.headers[name] ?? "");
    const { apiKey, apiSecret } = FAKE_CREDENTIALS.lcsc;
    const signed =
        `key=${header("key")}&nonce=${header("nonce")}&secret=${apiSecret}` +
        `&timestamp=${header("timestamp")}&${url.search.slice(1)}`;
    return (
        header("key") === apiKey &&
        header("signature") ===
            createHash("sha256").update(signed).digest("hex")
    );
}

function send(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
    let body = "";
    for await (const chunk of request) {
        body += String(chunk);
    }
    return body;
}

export async function startFakeSuppliers() {
    let mouserLimitUsed = false;
    const server = createServer((request, response) => {
        void (async () => {
            const url = new URL(request.url ?? "/", "http://localhost");
            const [, supplier] = url.pathname.split("/");
            const path = url.pathname.slice(supplier!.length + 1);
            const body = await readBody(request);

            if (supplier === "mouser" && path === "/api/v1/search/partnumber") {
                if (
                    url.searchParams.get("apiKey") !==
                    FAKE_CREDENTIALS.mouser.apiKey
                ) {
                    return send(response, 200, {
                        Errors: [
                            {
                                Code: "Invalid",
                                Message: "Invalid unique identifier.",
                                PropertyName: "API Key"
                            }
                        ],
                        SearchResults: null
                    });
                }
                const requested = (
                    JSON.parse(body) as {
                        SearchByPartRequest: { mouserPartNumber: string };
                    }
                ).SearchByPartRequest.mouserPartNumber.split("|");
                if (requested.includes(MOUSER_LIMIT_ONCE) && !mouserLimitUsed) {
                    mouserLimitUsed = true;
                    return send(response, 403, {
                        Errors: [
                            {
                                Code: "TooManyRequests",
                                Message: "Maximum calls per day exceeded.",
                                ResourceKey: "MaxCallPerDay"
                            }
                        ]
                    });
                }
                const parts = requested.flatMap(pn =>
                    MOUSER_PARTS[pn] ? [MOUSER_PARTS[pn]] : []
                );
                return send(response, 200, {
                    Errors: [],
                    SearchResults: {
                        NumberOfResult: parts.length,
                        Parts: parts
                    }
                });
            }

            if (supplier === "tme" && path === "/auth/token") {
                const expected = Buffer.from(
                    `${FAKE_CREDENTIALS.tme.token}:${FAKE_CREDENTIALS.tme.appSecret}`
                ).toString("base64");
                return request.headers.authorization === `Basic ${expected}`
                    ? send(response, 200, {
                          access_token: "tme-access",
                          token_type: "Bearer",
                          expires_in: 300
                      })
                    : send(response, 400, {
                          error: "invalid_request",
                          error_description: "E_TOKEN_NOT_FOUND"
                      });
            }
            if (
                supplier === "tme" &&
                (path === "/products" || path === "/products/data")
            ) {
                const known = url.searchParams
                    .getAll("symbols[]")
                    .filter(s => s === "1N4007-DIO");
                const elements =
                    path === "/products"
                        ? known.map(symbol => ({
                              symbol,
                              manufacturer: { name: "DIOTEC SEMICONDUCTOR" },
                              manufacturer_symbols: ["1N4007"],
                              description: "Diode: rectifying; THT; 1kV; 1A",
                              minimal_amount: 50,
                              multiples: 50,
                              product_status: []
                          }))
                        : known.map(symbol => ({
                              symbol,
                              stock_quantity: 120000,
                              prices: {
                                  elements: [
                                      {
                                          amount: 50,
                                          price: 0.0124,
                                          special: false
                                      }
                                  ],
                                  currency: "EUR",
                                  type: "NET"
                              }
                          }));
                return send(response, 200, {
                    status: "OK",
                    data: { elements }
                });
            }

            if (supplier === "digikey" && path === "/v1/oauth2/token") {
                const form = new URLSearchParams(body);
                return form.get("client_secret") ===
                    FAKE_CREDENTIALS.digikey.clientSecret
                    ? send(response, 200, {
                          access_token: "dk-access",
                          expires_in: 599,
                          token_type: "Bearer"
                      })
                    : send(response, 401, { ErrorMessage: "Invalid clientId" });
            }
            const detail =
                /^\/products\/v4\/search\/(.+)\/productdetails$/.exec(path);
            if (supplier === "digikey" && detail) {
                const product =
                    DIGIKEY_PRODUCTS[decodeURIComponent(detail[1]!)];
                if (!product) {
                    return send(response, 404, {
                        title: "Not Found",
                        status: 404
                    });
                }
                response.setHeader("X-RateLimit-Remaining", "999");
                return send(response, 200, {
                    Product: product,
                    SearchLocaleUsed: {
                        Site: "SI",
                        Language: "en",
                        Currency: "EUR"
                    }
                });
            }
            if (supplier === "lcsc" && path.startsWith("/rest/api/agent/")) {
                if (!lcscSignatureOk(request, url)) {
                    return send(response, 200, {
                        code: 4003,
                        message: "Invalid signature",
                        success: false,
                        result: null
                    });
                }
                const ok = (result: unknown) =>
                    send(response, 200, {
                        code: 200,
                        message: "ok",
                        success: true,
                        result
                    });
                if (path.endsWith("/product/v1/productdetails")) {
                    return ok(
                        LCSC_PRODUCTS[
                            url.searchParams.get("lcscProductNumber") ?? ""
                        ] ?? null
                    );
                }
                if (path.endsWith("/product/v1/keywordsearch")) {
                    const keyword = url.searchParams.get("keyword");
                    const products = Object.values(LCSC_PRODUCTS).filter(
                        product =>
                            (product as { manufacturerProductNumber: string })
                                .manufacturerProductNumber === keyword
                    );
                    return ok({ productCount: products.length, products });
                }
            }
            send(response, 404, {
                error: `No fake for ${request.method} ${url.pathname}`
            });
        })();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    return {
        urls: {
            digikey: `${base}/digikey`,
            mouser: `${base}/mouser`,
            tme: `${base}/tme`,
            lcsc: `${base}/lcsc`
        },
        close: () => new Promise<void>(resolve => server.close(() => resolve()))
    };
}
