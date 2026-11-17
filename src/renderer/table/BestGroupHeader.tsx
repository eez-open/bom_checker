import type { CustomHeaderGroupProps } from "ag-grid-react";
import { priceBreaksText, stockWarnings } from "../../shared/line-text";
import type { BomRow } from "../../shared/model";
import { openCostChart, openPriceBreaks } from "../commands";
import { WarningIcon } from "../icons";
import type { TableContext } from "./PartNumberCell";

/** The Best price group's header, with a button for the chart of the
 *  most expensive parts (#28). The grid keeps its own expand arrow. In
 *  red with a warning sign when the best price leaves out rows that no
 *  supplier can deliver (#49), or covers only part of rows that no
 *  supplier has enough stock for (#74). A second button tells how many
 *  rows cost less when more is ordered, up to a price break (#86).
 *  BomTable redraws the header when these numbers change. */
export function BestGroupHeader(
    props: CustomHeaderGroupProps<BomRow, TableContext>
) {
    const totals = props.context.getTotals().best;
    const warnings = stockWarnings(totals);
    const warning = warnings.length > 0 ? warnings.join("\n") : undefined;
    return (
        <span
            className={
                warning ? "group-header group-header-warning" : "group-header"
            }
            title={warning}
        >
            {warning && <WarningIcon />}
            {props.displayName}
            {warning && (
                <span className="visually-hidden">: {warnings.join(" ")}</span>
            )}
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
            {totals.cheaper > 0 && (
                <button
                    type="button"
                    className="group-header-button"
                    title={priceBreaksText(totals, props.context.getNumbers())}
                    onMouseDown={event => event.stopPropagation()}
                    onClick={event => {
                        event.stopPropagation();
                        openPriceBreaks();
                    }}
                >
                    {totals.cheaper} cheaper
                </button>
            )}
        </span>
    );
}
