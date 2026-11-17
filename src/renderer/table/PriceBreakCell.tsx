import type { CustomCellRendererProps } from "ag-grid-react";
import type { BomRow } from "../../shared/model";
import { openPriceBreaks } from "../commands";
import { InfoIcon } from "../icons";

/**
 * An Order Qty cell that costs less when more is ordered, up to a price
 * break, or was raised to one (#86): the quantity, and an icon that opens
 * Cheaper price breaks at the cell's row. The cell's tooltip has the
 * numbers.
 */
export function PriceBreakCell(
    props: CustomCellRendererProps<BomRow> & { raised: boolean }
) {
    const text = props.valueFormatted ?? String(props.value ?? "");
    const rowId = props.data?.id;
    return (
        <span className="price-break-cell">
            <button
                type="button"
                className="price-break-button"
                aria-label={
                    props.raised
                        ? "Raised to a price break: show"
                        : "Costs less at a price break: show"
                }
                // Not a row selection or the start of an edit.
                onMouseDown={event => event.stopPropagation()}
                onDoubleClick={event => event.stopPropagation()}
                onClick={event => {
                    event.stopPropagation();
                    openPriceBreaks(rowId);
                }}
            >
                <InfoIcon />
            </button>
            <span>{text}</span>
        </span>
    );
}
