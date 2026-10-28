// How numbers look (#37): with a decimal point (1,234.5), a decimal comma
// (1.234,5), or as the system's regional settings have them. The table,
// the dialogs and CSV exports use the same choice.

export const DECIMAL_SEPARATORS = ["system", "point", "comma"] as const;
export type DecimalSeparator = (typeof DECIMAL_SEPARATORS)[number];

/** Locales whose numbers look like 1,234.5 and 1.234,5. */
const POINT_LOCALE = "en-US";
const COMMA_LOCALE = "de-DE";

/** The locale numbers are formatted in. */
export function numberLocale(
    separator: DecimalSeparator,
    systemLocale: string
): string {
    switch (separator) {
        case "point":
            return POINT_LOCALE;
        case "comma":
            return COMMA_LOCALE;
        case "system":
            return systemLocale;
    }
}

/** Numbers in one style, for display and for text in exports. */
export interface Numbers {
    /** A comma separates the decimals, so CSV files use ";" between
     *  fields. */
    decimalComma: boolean;
    /** E.g. 1,234 or 0.004: up to 6 decimals. */
    quantity: (value: number) => string;
    /** 4 decimals: 0.0950. */
    unitPrice: (value: number) => string;
    /** 2 decimals: 62.50. */
    money: (value: number) => string;
    /** A supplier's price as given, up to 5 decimals. */
    price: (value: number) => string;
    /** One decimal: 12.5%. */
    percent: (value: number) => string;
    /** The number in full and without grouping, e.g. for a CSV cell. */
    plain: (value: number) => string;
}

function formats(locale: string): Intl.NumberFormat[] {
    const options: Intl.NumberFormatOptions[] = [
        { maximumFractionDigits: 6 },
        { minimumFractionDigits: 4, maximumFractionDigits: 4 },
        { minimumFractionDigits: 2, maximumFractionDigits: 2 },
        { maximumFractionDigits: 5 },
        { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }
    ];
    // Latin digits also where the system's region has others.
    return options.map(
        option =>
            new Intl.NumberFormat(locale, {
                ...option,
                numberingSystem: "latn"
            })
    );
}

const cache = new Map<string, Numbers>();

/** Numbers formatted for `locale`; an invalid locale gets decimal points. */
export function numbersFor(locale: string): Numbers {
    const cached = cache.get(locale);
    if (cached) {
        return cached;
    }
    let all: Intl.NumberFormat[];
    try {
        all = formats(locale);
    } catch {
        return numbersFor(POINT_LOCALE);
    }
    const [quantity, unitPrice, money, price, percent] = all as [
        Intl.NumberFormat,
        Intl.NumberFormat,
        Intl.NumberFormat,
        Intl.NumberFormat,
        Intl.NumberFormat
    ];
    const decimalComma =
        quantity.formatToParts(1.5).find(part => part.type === "decimal")
            ?.value === ",";
    const numbers: Numbers = {
        decimalComma,
        quantity: value => quantity.format(value),
        unitPrice: value => unitPrice.format(value),
        money: value => money.format(value),
        price: value => price.format(value),
        percent: value => percent.format(value),
        plain: value =>
            decimalComma ? String(value).replace(".", ",") : String(value)
    };
    cache.set(locale, numbers);
    return numbers;
}

/**
 * A number as typed in a cell: "." or "," separates the decimals ("0.5",
 * "0,5"), so either works whatever is shown; there's no grouping. Undefined
 * if it isn't a number.
 */
export function parseDecimal(text: string): number | undefined {
    const match = /^([-+]?\d*)(?:[.,](\d+))?$/.exec(text.trim());
    if (!match || (match[1]!.replace(/[-+]/, "") === "" && !match[2])) {
        return undefined;
    }
    const value = Number(`${match[1] || "0"}.${match[2] ?? "0"}`);
    return Number.isFinite(value) ? value : undefined;
}
