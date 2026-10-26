// Changes field values in a .kicad_sch file by replacing only the text of
// those values, so the rest of the file stays exactly as KiCad wrote it.

import { SExprError } from "./sexpr";

interface Span {
    start: number;
    /** One past the last character. */
    end: number;
}

export interface AtomNode extends Span {
    kind: "atom";
    value: string;
}

export interface ListNode extends Span {
    kind: "list";
    items: Node[];
}

export type Node = AtomNode | ListNode;

/** Parses the first expression of `text`, keeping where each part is. */
export function parseNodes(text: string): ListNode {
    const stack: ListNode[] = [];
    let i = 0;
    while (i < text.length) {
        const char = text[i]!;
        if (char === "(") {
            const list: ListNode = {
                kind: "list",
                start: i,
                end: -1,
                items: []
            };
            stack.at(-1)?.items.push(list);
            stack.push(list);
            i++;
        } else if (char === ")") {
            const list = stack.pop();
            if (!list) {
                throw new SExprError(`Unexpected ")" at offset ${i}.`);
            }
            list.end = ++i;
            if (stack.length === 0) {
                return list;
            }
        } else if (char === '"') {
            const start = i++;
            let value = "";
            while (i < text.length && text[i] !== '"') {
                if (text[i] === "\\" && i + 1 < text.length) {
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
                    value += text[i++];
                }
            }
            if (i >= text.length) {
                throw new SExprError("Unterminated string.");
            }
            stack.at(-1)?.items.push({
                kind: "atom",
                start,
                end: ++i,
                value
            });
        } else if (" \n\r\t".includes(char)) {
            i++;
        } else {
            const start = i;
            while (i < text.length && !' \n\r\t()"'.includes(text[i]!)) {
                i++;
            }
            stack.at(-1)?.items.push({
                kind: "atom",
                start,
                end: i,
                value: text.slice(start, i)
            });
        }
    }
    throw new SExprError("The file ends before the expression is complete.");
}

/** Child lists named `name`, e.g. all `(property …)` of a symbol. */
export function childLists(list: ListNode, name: string): ListNode[] {
    return list.items.filter(
        (item): item is ListNode =>
            item.kind === "list" &&
            item.items[0]?.kind === "atom" &&
            item.items[0].value === name
    );
}

/** The value of `(name "value")`. */
function childValue(list: ListNode, name: string): string | undefined {
    const value = childLists(list, name)[0]?.items[1];
    return value?.kind === "atom" ? value.value : undefined;
}

/** A string as KiCad writes it. */
export function kicadString(value: string): string {
    return `"${value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")}"`;
}

/** Where a field value lives: on the symbol, or in a design variant of one
 *  of its instances (a variant override). */
export type FieldTarget =
    | { kind: "property"; symbol: string; field: string }
    | {
          kind: "variant";
          symbol: string;
          /** The instance's sheet path. */
          path: string;
          variant: string;
          field: string;
      };

export interface FieldEdit {
    target: FieldTarget;
    value: string;
}

export class SchematicEditError extends Error {
    override name = "SchematicEditError";
}

interface TextEdit {
    start: number;
    end: number;
    text: string;
}

/**
 * Applies `edits` to the schematic `text`. A missing property is added as a
 * hidden field, copied from one of the symbol's hidden fields. Variant
 * overrides are only changed, never added.
 */
export function editFields(text: string, edits: readonly FieldEdit[]): string {
    const root = parseNodes(text);
    const symbols = new Map(
        childLists(root, "symbol").flatMap(symbol => {
            const uuid = childValue(symbol, "uuid");
            return uuid ? [[uuid, symbol] as const] : [];
        })
    );
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const textEdits: TextEdit[] = [];
    // Properties added to a symbol, in order, inserted after its last one.
    const added = new Map<ListNode, string[]>();

    for (const { target, value } of edits) {
        const symbol = symbols.get(target.symbol);
        if (!symbol) {
            throw new SchematicEditError(
                `Symbol ${target.symbol} is missing from the file.`
            );
        }
        if (target.kind === "variant") {
            const field = variantField(symbol, target);
            if (!field) {
                throw new SchematicEditError(
                    `The ${target.variant} variant of symbol ${target.symbol} has no ${target.field} field.`
                );
            }
            textEdits.push({ ...field, text: kicadString(value) });
            continue;
        }
        const property = childLists(symbol, "property").find(
            p =>
                p.items[1]?.kind === "atom" && p.items[1].value === target.field
        );
        const valueNode = property?.items[2];
        if (valueNode?.kind === "atom") {
            textEdits.push({ ...valueNode, text: kicadString(value) });
        } else if (!property) {
            const list = added.get(symbol) ?? [];
            list.push(newProperty(text, symbol, target.field, value, newline));
            added.set(symbol, list);
        } else {
            throw new SchematicEditError(
                `The ${target.field} field of symbol ${target.symbol} has no value.`
            );
        }
    }

    for (const [symbol, properties] of added) {
        const last = childLists(symbol, "property").at(-1);
        if (!last) {
            throw new SchematicEditError(
                "A symbol without fields can't get one."
            );
        }
        textEdits.push({
            start: last.end,
            end: last.end,
            text: properties.join("")
        });
    }

    let result = text;
    for (const edit of textEdits.sort((a, b) => b.start - a.start)) {
        result =
            result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    }
    return result;
}

function variantField(
    symbol: ListNode,
    target: Extract<FieldTarget, { kind: "variant" }>
): AtomNode | undefined {
    for (const instances of childLists(symbol, "instances")) {
        for (const project of childLists(instances, "project")) {
            for (const path of childLists(project, "path")) {
                if (path.items[1]?.kind !== "atom") {
                    continue;
                }
                if (path.items[1].value !== target.path) {
                    continue;
                }
                for (const variant of childLists(path, "variant")) {
                    if (childValue(variant, "name") !== target.variant) {
                        continue;
                    }
                    for (const field of childLists(variant, "field")) {
                        if (childValue(field, "name") === target.field) {
                            const value = childLists(field, "value")[0]
                                ?.items[1];
                            return value?.kind === "atom" ? value : undefined;
                        }
                    }
                }
            }
        }
    }
    return undefined;
}

/**
 * A hidden property for `symbol`: a copy of one of its hidden properties
 * (Footprint, normally), with the same position and text size, so KiCad
 * sees a field like the ones it writes itself.
 */
function newProperty(
    text: string,
    symbol: ListNode,
    field: string,
    value: string,
    newline: string
): string {
    const properties = childLists(symbol, "property");
    const template =
        properties.find(
            p =>
                childLists(p, "hide").length > 0 &&
                p.items[1]?.kind === "atom" &&
                p.items[1].value === "Footprint"
        ) ?? properties.find(p => childLists(p, "hide").length > 0);
    if (!template) {
        throw new SchematicEditError(
            `Symbol has no hidden field to model the new ${field} field on.`
        );
    }
    const name = template.items[1]!;
    const current = template.items[2]!;
    const lineStart = text.lastIndexOf("\n", template.start) + 1;
    const indent = text.slice(lineStart, template.start);
    const copy =
        text.slice(template.start, name.start) +
        kicadString(field) +
        text.slice(name.end, current.start) +
        kicadString(value) +
        text.slice(current.end, template.end);
    return newline + indent + copy;
}
