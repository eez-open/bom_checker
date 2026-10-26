// Choosing what each imported column becomes; shared by CSV and KiCad
// import.

import { useState } from "react";
import {
    suggestMapping,
    targetId,
    validateMapping,
    type ColumnTarget,
    type CsvTable
} from "../../shared/csv-import";
import { ALL_SUPPLIERS } from "../../shared/suppliers";
import { rememberedTargetIds } from "../import/remembered-mappings";

const TARGET_OPTIONS: { label: string; target: ColumnTarget }[] = [
    { label: "Don't import", target: { kind: "ignore" } },
    { label: "Row number (renumbered)", target: { kind: "row" } },
    { label: "Reference", target: { kind: "base", field: "reference" } },
    { label: "Value", target: { kind: "base", field: "value" } },
    { label: "Qty", target: { kind: "base", field: "qty" } },
    { label: "Footprint", target: { kind: "base", field: "footprint" } },
    ...ALL_SUPPLIERS.map(supplier => ({
        label: `${supplier.name} part number`,
        target: { kind: "partNumber", supplier: supplier.id } as const
    })),
    { label: "Custom column (text)", target: { kind: "custom", type: "text" } },
    {
        label: "Custom column (number)",
        target: { kind: "custom", type: "number" }
    }
];

const TARGETS_BY_ID = new Map(
    TARGET_OPTIONS.map(option => [targetId(option.target), option.target])
);

/** The mapping last used for these headers, or a suggestion. */
function initialMapping(
    headers: readonly string[],
    suggest: (headers: readonly string[]) => ColumnTarget[]
): ColumnTarget[] {
    const remembered = rememberedTargetIds(headers)?.map(id =>
        TARGETS_BY_ID.get(id)
    );
    return remembered?.every(target => target !== undefined)
        ? remembered
        : suggest(headers);
}

/**
 * The mapping for `table`. It belongs to one set of headers: when they
 * change (another text encoding, another KiCad variant with other
 * fields), the mapping starts over.
 */
export function useColumnMapping(
    table: CsvTable,
    suggest: (headers: readonly string[]) => ColumnTarget[] = suggestMapping
) {
    const headersKey = JSON.stringify(table.headers);
    const [state, setState] = useState(() => ({
        headersKey,
        mapping: initialMapping(table.headers, suggest)
    }));
    const mapping =
        state.headersKey === headersKey
            ? state.mapping
            : initialMapping(table.headers, suggest);

    const setTarget = (column: number, id: string) => {
        const target = TARGETS_BY_ID.get(id);
        if (target) {
            setState({
                headersKey,
                mapping: mapping.map((t, i) => (i === column ? target : t))
            });
        }
    };

    return { mapping, setTarget, errors: validateMapping(mapping) };
}

/** Up to three different example values from a column. */
function examples(table: CsvTable, column: number): string {
    const values = new Set<string>();
    for (const row of table.rows) {
        const value = row[column]?.trim();
        if (value) {
            values.add(value.length > 30 ? `${value.slice(0, 29)}…` : value);
        }
        if (values.size === 3) {
            break;
        }
    }
    return [...values].join(" · ");
}

export function ColumnMappingTable({
    table,
    mapping,
    columnLabel,
    onChange
}: {
    table: CsvTable;
    mapping: readonly ColumnTarget[];
    /** Header of the first column, e.g. "CSV column". */
    columnLabel: string;
    onChange: (column: number, targetId: string) => void;
}) {
    return (
        <table className="mapping">
            <thead>
                <tr>
                    <th>{columnLabel}</th>
                    <th>Examples</th>
                    <th>Import as</th>
                </tr>
            </thead>
            <tbody>
                {table.headers.map((header, column) => (
                    <tr key={column}>
                        <td>{header || <em>(no header)</em>}</td>
                        <td className="muted">{examples(table, column)}</td>
                        <td>
                            <select
                                aria-label={`Import "${header}" as`}
                                value={targetId(mapping[column]!)}
                                onChange={event =>
                                    onChange(column, event.target.value)
                                }
                            >
                                {TARGET_OPTIONS.map(option => (
                                    <option
                                        key={targetId(option.target)}
                                        value={targetId(option.target)}
                                    >
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
