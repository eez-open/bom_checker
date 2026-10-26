// A reader for KiCad's S-expression files (.kicad_sch). Strings and bare
// atoms both become JavaScript strings; lists become arrays.

export type SExpr = string | SList;
export type SList = SExpr[];

export class SExprError extends Error {
    override name = "SExprError";
}

/** Parses the first expression of `text`. */
export function parseSExpr(text: string): SList {
    const stack: SList[] = [];
    let result: SList | undefined;
    let i = 0;
    const length = text.length;

    while (i < length) {
        const char = text[i]!;
        if (char === "(") {
            const list: SList = [];
            stack.at(-1)?.push(list);
            stack.push(list);
            i++;
        } else if (char === ")") {
            const list = stack.pop();
            if (!list) {
                throw new SExprError(`Unexpected ")" at offset ${i}.`);
            }
            if (stack.length === 0) {
                result = list;
                break;
            }
            i++;
        } else if (char === '"') {
            let value = "";
            i++;
            while (i < length && text[i] !== '"') {
                if (text[i] === "\\" && i + 1 < length) {
                    const next = text[i + 1]!;
                    value +=
                        next === "n"
                            ? "\n"
                            : next === "t"
                              ? "\t"
                              : next === "r"
                                ? "\r"
                                : next;
                    i += 2;
                } else {
                    value += text[i];
                    i++;
                }
            }
            if (i >= length) {
                throw new SExprError("Unterminated string.");
            }
            stack.at(-1)?.push(value);
            i++;
        } else if (
            char === " " ||
            char === "\n" ||
            char === "\r" ||
            char === "\t"
        ) {
            i++;
        } else {
            const start = i;
            while (i < length && !' \n\r\t()"'.includes(text[i]!)) {
                i++;
            }
            stack.at(-1)?.push(text.slice(start, i));
        }
    }
    if (!result) {
        throw new SExprError(
            "The file ends before the expression is complete."
        );
    }
    return result;
}

export function isList(expression: SExpr | undefined): expression is SList {
    return Array.isArray(expression);
}

/** The direct child lists named `name`, e.g. all `(property …)`. */
export function children(list: SList, name: string): SList[] {
    return list.filter(
        (item): item is SList => isList(item) && item[0] === name
    );
}

export function child(list: SList, name: string): SList | undefined {
    return children(list, name)[0];
}

/** The value of `(name value)`. */
export function atom(list: SList, name: string): string | undefined {
    const value = child(list, name)?.[1];
    return typeof value === "string" ? value : undefined;
}

/** `(name yes)` → true, `(name no)` → false, a bare `(name)` → true, and
 *  undefined when missing. */
export function flag(list: SList, name: string): boolean | undefined {
    const found = child(list, name);
    if (!found) {
        return undefined;
    }
    return found[1] === undefined || found[1] === "yes";
}
