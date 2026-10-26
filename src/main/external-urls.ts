// Web pages the UI may open in the browser: supplier sites only. The
// supplier name must be followed directly by the top-level domain (.com,
// a country, or .co/.com plus a country), so "mouser.com.example" fails.
const TOP_LEVEL = String.raw`(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})`;
const ALLOWED_HOSTS = [
    new RegExp(String.raw`^([a-z0-9-]+\.)*digikey\.${TOP_LEVEL}$`),
    new RegExp(String.raw`^([a-z0-9-]+\.)*mouser\.${TOP_LEVEL}$`),
    /^([a-z0-9-]+\.)*tme\.eu$/
];

export function isAllowedExternalUrl(url: string): boolean {
    try {
        const { protocol, hostname } = new URL(url);
        return (
            protocol === "https:" &&
            ALLOWED_HOSTS.some(pattern => pattern.test(hostname))
        );
    } catch {
        return false;
    }
}
