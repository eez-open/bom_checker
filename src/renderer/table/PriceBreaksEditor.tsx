import { useGridCellEditor, type CustomCellEditorProps } from "ag-grid-react";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent
} from "react";
import {
    MAX_MANUAL_PRICES,
    parsePriceBreaks,
    type PriceBreakText
} from "../../shared/manual-prices";
import type { BomRow } from "../../shared/model";
import { BASE_CURRENCY, manualPriceBreaks } from "../../shared/pricing";
import type { TableContext } from "./PartNumberCell";

/** A key that types a character, which then starts the first price. */
function typedCharacter(key: string | null): string | null {
    return key && key.length === 1 && key !== " " ? key : null;
}

/**
 * The Unit price editor of a supplier without an API (#51): the unit price
 * from 1 piece on, and up to three lower prices for larger quantities.
 * Enter keeps them, Escape cancels; Tab moves between the fields.
 */
export function PriceBreaksEditor(
    props: CustomCellEditorProps<BomRow, unknown, TableContext> & {
        supplier: string;
        name: string;
    }
) {
    const { supplier, name, data, eventKey, onValueChange } = props;
    const numbers = props.context.getNumbers();
    // Typing on the cell starts the price from 1 over.
    const typed = typedCharacter(eventKey);
    const [rows, setRows] = useState<PriceBreakText[]>(() => {
        const breaks = manualPriceBreaks(data?.manual?.[supplier]);
        return Array.from({ length: MAX_MANUAL_PRICES }, (_, index) => {
            const known = breaks[index];
            if (index === 0 && typed !== null) {
                return { qty: "1", price: typed };
            }
            return known
                ? {
                      qty: numbers.plain(known.qty),
                      price: numbers.plain(known.unitPrice)
                  }
                : { qty: index === 0 ? "1" : "", price: "" };
        });
    });
    const parsed = useMemo(() => parsePriceBreaks(rows), [rows]);
    const error = "error" in parsed ? parsed.error : null;
    const root = useRef<HTMLDivElement>(null);
    const first = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if ("breaks" in parsed) {
            onValueChange(parsed.breaks);
        }
    }, [parsed, onValueChange]);

    useEffect(() => {
        const input = first.current;
        if (!input) {
            return;
        }
        input.focus();
        if (typed !== null) {
            input.setSelectionRange(input.value.length, input.value.length);
        } else {
            input.select();
        }
        // Only when the editor opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useGridCellEditor({
        getValidationErrors: () => (error ? [error] : null),
        getValidationElement: () => root.current,
        isCancelAfterEnd: () => error !== null
    });

    const set = (index: number, field: keyof PriceBreakText, value: string) =>
        setRows(current =>
            current.map((row, i) =>
                i === index ? { ...row, [field]: value } : row
            )
        );

    // Tab stays among the fields.
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Tab") {
            return;
        }
        const inputs = [
            ...(root.current?.querySelectorAll("input") ?? [])
        ] as HTMLInputElement[];
        const index = inputs.indexOf(event.target as HTMLInputElement);
        const next = event.shiftKey ? index - 1 : index + 1;
        const target = inputs[(next + inputs.length) % inputs.length];
        if (target) {
            event.preventDefault();
            target.focus();
            target.select();
        }
    };

    return (
        <div
            ref={root}
            className="price-breaks-editor"
            role="group"
            aria-label={`${name} unit prices`}
            onKeyDown={onKeyDown}
        >
            <table>
                <thead>
                    <tr>
                        <th>From qty</th>
                        <th>Unit price ({BASE_CURRENCY})</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={index}>
                            <td>
                                {index === 0 ? (
                                    <span>1</span>
                                ) : (
                                    <input
                                        aria-label={`Price break ${index + 1} quantity`}
                                        inputMode="decimal"
                                        value={row.qty}
                                        onChange={event =>
                                            set(
                                                index,
                                                "qty",
                                                event.target.value
                                            )
                                        }
                                    />
                                )}
                            </td>
                            <td>
                                <input
                                    ref={index === 0 ? first : undefined}
                                    aria-label={`Price break ${index + 1} unit price`}
                                    inputMode="decimal"
                                    value={row.price}
                                    onChange={event =>
                                        set(index, "price", event.target.value)
                                    }
                                />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className={error ? "field-error" : "muted"} role="status">
                {error ??
                    "Lower prices for larger quantities are optional. Enter keeps the prices, Esc cancels."}
            </p>
        </div>
    );
}
