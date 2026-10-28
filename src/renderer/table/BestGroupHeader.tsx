import type { CustomHeaderGroupProps } from "ag-grid-react";
import { uncoveredText } from "../../shared/line-text";
import type { BomRow } from "../../shared/model";
import { openCostChart } from "../commands";
import { WarningIcon } from "../icons";
import type { TableContext } from "./PartNumberCell";

/** The Best price group's header, with a button for the chart of the
 *  most expensive parts (#28). The grid keeps its own expand arrow. In
 *  red with a warning sign when the best price leaves out rows that no
 *  supplier has enough stock for (#49); BomTable redraws it when their
 *  number changes. */
export function BestGroupHeader(
    props: CustomHeaderGroupProps<BomRow, TableContext>
) {
    const { uncovered } = props.context.getTotals().best;
    const warning = uncovered > 0 ? uncoveredText(uncovered) : undefined;
    return (
        <span
            className={
                warning ? "group-header group-header-warning" : "group-header"
            }
            title={warning}
        >
            {warning && <WarningIcon />}
            {props.displayName}
            {warning && <span className="visually-hidden">: {warning}</span>}
            <button
                type="button"
                className="group-header-button"
                title="Chart of the 10 most expensive parts"
                // Not a column drag or a click on the header.
                onMouseDown={event => event.stopPropagation()}
                onClick={event => {
                    event.stopPropagation();
                    openCostChart();
                }}
            >
                Top 10
            </button>
        </span>
    );
}
