// Settings each supplier needs. The Settings dialog is generated from these
// definitions; main validates against them. Fields of kind "secret" are
// stored only in the encrypted vault and never sent to the UI.
//
// Settings belong to an account: each supplier's own, except that Arrow's
// inventory sources ("Arrow (EUROPE)", …) share Arrow's (#62).

import { SUPPLIER_IDS, type SupplierId } from "./model";

/** What has settings and credentials. */
export const ACCOUNT_IDS = [
    "digikey",
    "mouser",
    "tme",
    "lcsc",
    "arrow"
] as const;
export type AccountId = (typeof ACCOUNT_IDS)[number];

export function isAccountId(value: unknown): value is AccountId {
    return ACCOUNT_IDS.includes(value as AccountId);
}

/** Arrow's inventory sources (#62): the `sourceCd` of its API, and the
 *  supplier each one is in the BOM. API keys search these four. */
export const ARROW_SOURCES = [
    { code: "EUROPE", supplier: "arrow-europe", label: "Arrow Europe" },
    { code: "ACNA", supplier: "arrow-acna", label: "Arrow North America" },
    { code: "ASIA", supplier: "arrow-asia", label: "Arrow Asia" },
    { code: "VERICAL", supplier: "arrow-verical", label: "Verical marketplace" }
] as const satisfies readonly {
    code: string;
    supplier: SupplierId;
    label: string;
}[];

export type ConfigValue = string | number;
export type SupplierConfig = Record<string, ConfigValue>;

interface FieldBase {
    key: string;
    label: string;
    help?: string;
    group: "credentials" | "options" | "limits";
}

export type ConfigField =
    | (FieldBase & { kind: "secret" })
    | (FieldBase & { kind: "text"; default: string; pattern?: RegExp })
    | (FieldBase & {
          kind: "number";
          default: number;
          min: number;
          max: number;
          unit?: string;
      })
    | (FieldBase & {
          kind: "select";
          default: string;
          options: readonly { value: string; label: string }[];
      })
    | (FieldBase & {
          /** Several of the options, as "A,B"; at least one. */
          kind: "multiselect";
          default: string;
          options: readonly { value: string; label: string }[];
      });

export interface SupplierSettingsInfo {
    /** Where to get API access. */
    docsUrl: string;
    fields: readonly ConfigField[];
}

function rateLimitFields(defaults: {
    minIntervalMs: number;
    perMinute: number;
    perDay: number;
}): ConfigField[] {
    return [
        {
            key: "minIntervalMs",
            label: "Time between requests",
            kind: "number",
            group: "limits",
            default: defaults.minIntervalMs,
            min: 0,
            max: 60_000,
            unit: "ms"
        },
        {
            key: "perMinute",
            label: "Requests per minute",
            kind: "number",
            group: "limits",
            default: defaults.perMinute,
            min: 0,
            max: 100_000,
            help: "0 means no limit."
        },
        {
            key: "perDay",
            label: "Requests per day",
            kind: "number",
            group: "limits",
            default: defaults.perDay,
            min: 0,
            max: 10_000_000,
            help: "0 means no limit."
        }
    ];
}

const DIGIKEY_SITES = [
    ["AT", "Austria"],
    ["BE", "Belgium"],
    ["DE", "Germany"],
    ["EE", "Estonia"],
    ["ES", "Spain"],
    ["FI", "Finland"],
    ["FR", "France"],
    ["GR", "Greece"],
    ["IE", "Ireland"],
    ["IT", "Italy"],
    ["LT", "Lithuania"],
    ["LU", "Luxembourg"],
    ["LV", "Latvia"],
    ["NL", "Netherlands"],
    ["PT", "Portugal"],
    ["SI", "Slovenia"],
    ["SK", "Slovakia"],
    ["US", "United States"]
].map(([value, label]) => ({ value: value!, label: `${label} (${value})` }));

export const SUPPLIER_SETTINGS: Record<AccountId, SupplierSettingsInfo> = {
    digikey: {
        docsUrl: "https://developer.digikey.com/",
        fields: [
            {
                key: "clientId",
                label: "Client ID",
                kind: "secret",
                group: "credentials"
            },
            {
                key: "clientSecret",
                label: "Client secret",
                kind: "secret",
                group: "credentials"
            },
            {
                key: "accountId",
                label: "Account number",
                kind: "secret",
                group: "credentials",
                help: "Your DigiKey account number, needed for your own prices."
            },
            {
                key: "site",
                label: "Site",
                kind: "select",
                group: "options",
                default: "SI",
                options: DIGIKEY_SITES,
                help: "Croatia isn't a DigiKey site; a eurozone site returns EUR prices."
            },
            {
                key: "currency",
                label: "Currency",
                kind: "select",
                group: "options",
                default: "EUR",
                options: [
                    { value: "EUR", label: "EUR" },
                    { value: "USD", label: "USD" }
                ]
            },
            {
                key: "environment",
                label: "API environment",
                kind: "select",
                group: "options",
                default: "production",
                options: [
                    { value: "production", label: "Production" },
                    { value: "sandbox", label: "Sandbox (test data only)" }
                ]
            },
            ...rateLimitFields({
                minIntervalMs: 600,
                perMinute: 120,
                perDay: 1000
            })
        ]
    },
    mouser: {
        docsUrl: "https://www.mouser.com/api-hub/",
        fields: [
            {
                key: "apiKey",
                label: "Search API key",
                kind: "secret",
                group: "credentials",
                help: "The Search API key, not the Order API key."
            },
            ...rateLimitFields({
                minIntervalMs: 2000,
                perMinute: 30,
                perDay: 1000
            })
        ]
    },
    tme: {
        docsUrl: "https://developers.tme.eu/",
        fields: [
            {
                key: "token",
                label: "Token",
                kind: "secret",
                group: "credentials",
                help:
                    "The private key from developers.tme.eu (your application → Show private keys), " +
                    "not the shortened token shown on tme.eu. It returns your own prices."
            },
            {
                key: "appSecret",
                label: "App secret",
                kind: "secret",
                group: "credentials",
                help: "Your application's Application secret on developers.tme.eu (eye icon)."
            },
            {
                key: "country",
                label: "Country",
                kind: "text",
                group: "options",
                default: "HR",
                pattern: /^[A-Z]{2}$/,
                help: "Two-letter country code, e.g. HR."
            },
            {
                key: "language",
                label: "Language",
                kind: "text",
                group: "options",
                default: "EN",
                pattern: /^[A-Z]{2}$/
            },
            {
                key: "currency",
                label: "Currency",
                kind: "select",
                group: "options",
                default: "EUR",
                options: [
                    { value: "EUR", label: "EUR" },
                    { value: "USD", label: "USD" },
                    { value: "PLN", label: "PLN" }
                ]
            },
            ...rateLimitFields({ minIntervalMs: 500, perMinute: 0, perDay: 0 })
        ]
    },
    lcsc: {
        docsUrl: "https://www.lcsc.com/agent",
        fields: [
            {
                key: "apiKey",
                label: "Key",
                kind: "secret",
                group: "credentials",
                help:
                    "Sent by LCSC when your API application is approved (lcsc.com/agent/apply). " +
                    "LCSC only accepts calls from the public IP addresses registered for your account."
            },
            {
                key: "apiSecret",
                label: "Secret",
                kind: "secret",
                group: "credentials",
                help: "Issued together with the key."
            },
            {
                key: "currency",
                label: "Currency",
                kind: "select",
                group: "options",
                default: "EUR",
                options: [
                    { value: "EUR", label: "EUR" },
                    { value: "USD", label: "USD" }
                ]
            },
            {
                key: "environment",
                label: "API environment",
                kind: "select",
                group: "options",
                default: "production",
                options: [
                    { value: "production", label: "Production" },
                    { value: "sandbox", label: "Sandbox (test data only)" }
                ],
                help: "New keys work only in the sandbox until LCSC activates them for production."
            },
            {
                key: "apiAddress",
                label: "API address",
                kind: "text",
                group: "options",
                default: "",
                // Empty, or an http(s) address without a query.
                pattern: /^(https?:\/\/[^\s/?#]+(\/[^\s?#]*)?)?$/,
                help:
                    "Leave empty to connect to LCSC directly. To go through a relay on a server " +
                    "whose IP address is registered at LCSC, enter the relay's address, " +
                    "e.g. https://example.com/lcsc. All requests then go there, whichever " +
                    "environment is chosen."
            },
            ...rateLimitFields({
                minIntervalMs: 1000,
                perMinute: 60,
                perDay: 1000
            })
        ]
    },
    arrow: {
        docsUrl: "https://developers.arrow.com/api/",
        fields: [
            {
                key: "login",
                label: "Login",
                kind: "secret",
                group: "credentials",
                help: "The login of your Pricing & Availability API key, from developers.arrow.com."
            },
            {
                key: "apiKey",
                label: "API key",
                kind: "secret",
                group: "credentials",
                help: "The Pricing & Availability API key, not the Order API key."
            },
            {
                key: "sources",
                label: "Inventory sources",
                kind: "multiselect",
                group: "options",
                default: "EUROPE",
                options: ARROW_SOURCES.map(source => ({
                    value: source.code,
                    label: `${source.label} (${source.code})`
                })),
                help: "Each one is a supplier of its own, e.g. Arrow (EUROPE), with its own part-number column, stock and prices."
            },
            {
                key: "currency",
                label: "Currency",
                kind: "select",
                group: "options",
                default: "EUR",
                options: [
                    { value: "EUR", label: "EUR" },
                    { value: "USD", label: "USD" }
                ],
                help: "Arrow converts prices from USD."
            },
            {
                key: "partsPerRequest",
                label: "Part numbers per request",
                kind: "select",
                group: "limits",
                default: "100",
                options: ["10", "20", "50", "100", "1000"].map(value => ({
                    value,
                    label: value === "1000" ? "1000 (all of most BOMs)" : value
                })),
                help: "Arrow's best practices say up to 100; its list search accepts up to 1000."
            },
            ...rateLimitFields({ minIntervalMs: 1000, perMinute: 0, perDay: 0 })
        ]
    }
};

export function secretFields(account: AccountId): ConfigField[] {
    return SUPPLIER_SETTINGS[account].fields.filter(f => f.kind === "secret");
}

export function defaultSupplierConfig(account: AccountId): SupplierConfig {
    return normalizeSupplierConfig(account, {});
}

/** Takes valid values from `raw` and defaults for the rest; secrets and
 *  unknown keys are dropped. Used for files written by older versions. */
export function normalizeSupplierConfig(
    account: AccountId,
    raw: unknown
): SupplierConfig {
    const values = isRecord(raw) ? raw : {};
    const config: SupplierConfig = {};
    for (const field of SUPPLIER_SETTINGS[account].fields) {
        if (field.kind !== "secret") {
            const value = values[field.key];
            config[field.key] =
                fieldError(field, value) === null
                    ? (value as ConfigValue)
                    : field.default;
        }
    }
    return config;
}

/** Errors by field key; empty when `config` can be saved. */
export function validateSupplierConfig(
    account: AccountId,
    config: Record<string, unknown>
): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const field of SUPPLIER_SETTINGS[account].fields) {
        const error =
            field.kind === "secret"
                ? null
                : fieldError(field, config[field.key]);
        if (error) {
            errors[field.key] = error;
        }
    }
    return errors;
}

function fieldError(field: ConfigField, value: unknown): string | null {
    switch (field.kind) {
        case "secret":
            return null;
        case "text":
            if (typeof value !== "string") {
                return "Required.";
            }
            return field.pattern && !field.pattern.test(value)
                ? "Invalid value."
                : null;
        case "select":
            return field.options.some(option => option.value === value)
                ? null
                : "Choose a value.";
        case "multiselect": {
            const chosen = typeof value === "string" ? value.split(",") : [];
            return chosen.length > 0 &&
                chosen.every(part =>
                    field.options.some(option => option.value === part)
                )
                ? null
                : "Choose at least one.";
        }
        case "number":
            if (typeof value !== "number" || !Number.isInteger(value)) {
                return "Enter a whole number.";
            }
            return value < field.min || value > field.max
                ? `Enter ${field.min} to ${field.max}.`
                : null;
    }
}

export function isSupplierId(value: unknown): value is SupplierId {
    return SUPPLIER_IDS.includes(value as SupplierId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The Arrow inventory sources chosen in Arrow's settings (#62). */
export function arrowSources(config: SupplierConfig | undefined): string[] {
    const chosen = String(config?.sources ?? "").split(",");
    return ARROW_SOURCES.map(source => source.code).filter(code =>
        chosen.includes(code)
    );
}
