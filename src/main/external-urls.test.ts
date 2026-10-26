import { describe, expect, it } from "vitest";
import { isAllowedExternalUrl } from "./external-urls";

describe("isAllowedExternalUrl", () => {
    it.each([
        "https://developer.digikey.com/",
        "https://www.digikey.si/en/products/detail/x/y/123",
        "https://www.mouser.com/api-hub/",
        "https://hr.mouser.com/ProductDetail/abc",
        "https://developers.tme.eu/",
        "https://www.tme.eu/hr/details/abc/",
        "https://www.mouser.co.uk/",
        "https://www.digikey.com.au/"
    ])("allows %s", url => expect(isAllowedExternalUrl(url)).toBe(true));

    it.each([
        "http://www.mouser.com/",
        "https://mouser.com.evil.example/",
        "https://www.digikey.com.evil.example/",
        "https://digikey.evil.com/",
        "https://evil-digikey.com/",
        "https://tme.eu.example.com/",
        "file:///C:/Windows/system32/calc.exe",
        "javascript:alert(1)",
        "not a url"
    ])("blocks %s", url => expect(isAllowedExternalUrl(url)).toBe(false));
});
