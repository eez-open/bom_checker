import type { CustomHeaderGroupProps } from "ag-grid-react";
import type { BomRow } from "../../shared/model";
import { openCostChart } from "../commands";

/** The Best price group's header, with a button for the chart of the
 *  most expensive parts (#28). The grid keeps its own expand arrow. */
export function BestGroupHeader(props: CustomHeaderGroupProps<BomRow>) {
    return (
        <span className="group-header">
            {props.displayName}
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
