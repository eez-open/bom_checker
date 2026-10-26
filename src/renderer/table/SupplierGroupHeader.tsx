import type { CustomHeaderGroupProps } from "ag-grid-react";
import { formatDateTime } from "../../shared/collection";
import type { BomRow } from "../../shared/model";

/** A supplier's group header: its name and when its data was collected.
 *  The grid keeps its own expand/collapse arrow around it. */
export function SupplierGroupHeader(
    props: CustomHeaderGroupProps<BomRow> & { collectedAt: string | null }
) {
    return (
        <span className="group-header">
            {props.displayName}
            {props.collectedAt && (
                <span
                    className="group-header-date"
                    title="When this supplier's data was last collected"
                >
                    collected {formatDateTime(props.collectedAt)}
                </span>
            )}
        </span>
    );
}
