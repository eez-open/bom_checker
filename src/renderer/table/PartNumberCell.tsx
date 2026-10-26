import type { CustomCellRendererProps } from "ag-grid-react";
import {
    partNumberKey,
    type BomRow,
    type CollectedData,
    type LookupResult,
    type SupplierId
} from "../../shared/model";
import { hasAlternatives, isPartNumberDefined } from "../../shared/part-number";
import type { BomTotals, ColumnTotal } from "../../shared/pricing";
import { useUi } from "../store/ui";

/** Passed to the grid as `context`, so cells can read data that isn't in
 *  the rows. */
export interface TableContext {
    getCollected: () => CollectedData;
    /** Preferred supplier order, for best price ties. */
    getPreference: () => readonly SupplierId[];
    /** Sums for the pinned Total row. */
    getTotals: () => TableTotals;
}

export interface TableTotals {
    rows: number;
    suppliers: Partial<Record<SupplierId, ColumnTotal>>;
    best: BomTotals;
}

const BADGES: Record<
    LookupResult["status"],
    { symbol: string; label: string }
> = {
    found: { symbol: "✓", label: "Found" },
    notFound: { symbol: "✗", label: "Not found" },
    ambiguous: { symbol: "?", label: "Several matches" },
    error: { symbol: "!", label: "Couldn't check" }
};

export function resultFor(
    context: unknown,
    supplier: SupplierId,
    value: string | null | undefined
): LookupResult | undefined {
    if (!isPartNumberDefined(value) || hasAlternatives(value)) {
        return undefined;
    }
    const collected = (context as TableContext).getCollected();
    return collected.results[supplier]?.[partNumberKey(value!)];
}

export function PartNumberCell(
    props: CustomCellRendererProps<BomRow, string> & { supplier: SupplierId }
) {
    const result = resultFor(props.context, props.supplier, props.value);
    const badge = result ? BADGES[result.status] : null;
    return (
        <span className="pn-cell">
            {badge && result?.status === "ambiguous" ? (
                // Several supplier items match: let the user choose one.
                <button
                    type="button"
                    className="pn-badge pn-ambiguous"
                    aria-label="Choose the item"
                    title="Choose the item"
                    onClick={event => {
                        event.stopPropagation();
                        useUi.setState({
                            dialog: {
                                kind: "choose-item",
                                supplier: props.supplier,
                                key: partNumberKey(props.value!)
                            }
                        });
                    }}
                >
                    {badge.symbol}
                </button>
            ) : (
                badge && (
                    <span
                        className={`pn-badge pn-${result!.status}`}
                        role="img"
                        aria-label={badge.label}
                    >
                        {badge.symbol}
                    </span>
                )
            )}
            <span>{props.value}</span>
        </span>
    );
}
