import { useMemo, useState } from "react";
import { fileTitle } from "../../shared/bom-list";
import { costBreakdown, type CostBreakdown } from "../../shared/cost-breakdown";
import { BASE_CURRENCY } from "../../shared/pricing";
import {
    chartPicture,
    describeItem,
    labelPoint,
    pictureToPng,
    segmentPath,
    slicesOf,
    type Ring
} from "../cost-chart";
import { errorMessage } from "../errors";
import { documentName, useDocument } from "../store/document";
import { useAppSettings } from "../store/settings";
import { useWorkspace } from "../store/workspace";
import { Modal } from "./Modal";

const MONEY = new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});
const PERCENT = new Intl.NumberFormat("en", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
});

// The ring, in SVG units.
const SIZE = 240;
const RING: Ring = { cx: SIZE / 2, cy: SIZE / 2, outer: 116, inner: 70 };

function summaryOf(
    { items, other, total }: CostBreakdown,
    buildQuantity: number
): string {
    const units = buildQuantity > 1 ? ` for ${buildQuantity} units` : "";
    return other
        ? `The ${items.length} most expensive rows make up ${PERCENT.format(1 - other.share)} of the best price total, ${MONEY.format(total)} ${BASE_CURRENCY}${units}.`
        : `Best price total: ${MONEY.format(total)} ${BASE_CURRENCY}${units}, from ${items.length} ${items.length === 1 ? "row" : "rows"} with a price.`;
}

/**
 * The most expensive parts at their best price (#28): a ring with a colour
 * per rank and the rest in gray, beside a table with every number, so the
 * chart is never the only way to read them. It can be copied or saved as
 * a picture.
 */
export function CostChartDialog({ onClose }: { onClose: () => void }) {
    const project = useDocument(state => state.project);
    const listName = useWorkspace(state =>
        state.list ? fileTitle(state.list.filePath) : null
    );
    const name = useDocument(state =>
        state.readOnly && listName
            ? `${listName} (combined)`
            : documentName(state.filePath)
    );
    const preference = useAppSettings(
        state => state.settings.general.supplierOrder
    );
    const breakdown = useMemo(
        () => costBreakdown(project, preference),
        [project, preference]
    );
    // The slice or table row under the pointer.
    const [active, setActive] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const { items, other, total } = breakdown;
    const slices = slicesOf(breakdown);
    const summary = summaryOf(breakdown, project.buildQuantity);

    const hover = (key: string) => ({
        onMouseEnter: () => setActive(key),
        onMouseLeave: () => setActive(null)
    });
    const title = (index: number) => {
        const item = items[index];
        return item
            ? `${index + 1}. ${describeItem(item)}: ${MONEY.format(item.total)} ${BASE_CURRENCY} (${PERCENT.format(item.share)})`
            : `Other ${other!.rows} ${other!.rows === 1 ? "row" : "rows"}: ${MONEY.format(other!.total)} ${BASE_CURRENCY} (${PERCENT.format(other!.share)})`;
    };

    const png = () =>
        pictureToPng(
            chartPicture(breakdown, `${name}: most expensive parts`, summary)
        );
    const copy = async () => {
        try {
            await window.api.app.copyImage(await png());
            setMessage("The chart was copied.");
        } catch (caught) {
            setMessage(`The chart can't be copied: ${errorMessage(caught)}`);
        }
    };
    const save = async () => {
        try {
            const path = await window.api.export.saveImage(
                await png(),
                `${name} - most expensive parts`
            );
            if (path) {
                setMessage(`Saved as ${path.split(/[\\/]/).pop()}.`);
            }
        } catch (caught) {
            setMessage(`The chart can't be saved: ${errorMessage(caught)}`);
        }
    };

    return (
        <Modal
            title="Most expensive parts"
            name="cost-chart"
            size="large"
            onClose={onClose}
            footer={
                <>
                    {message && (
                        <span className="modal-footer-info" role="status">
                            {message}
                        </span>
                    )}
                    {items.length > 0 && (
                        <>
                            <button type="button" onClick={() => void copy()}>
                                Copy picture
                            </button>
                            <button type="button" onClick={() => void save()}>
                                Save as PNG…
                            </button>
                        </>
                    )}
                    <button type="button" onClick={onClose}>
                        Close
                    </button>
                </>
            }
        >
            {items.length === 0 ? (
                <p>
                    No prices yet. Collect supplier data, or type in the prices
                    of a supplier without an API, to see which parts cost the
                    most.
                </p>
            ) : (
                <>
                    <p data-testid="cost-summary">{summary}</p>
                    <div className="cost-chart">
                        <svg
                            viewBox={`0 0 ${SIZE} ${SIZE}`}
                            width={SIZE}
                            height={SIZE}
                            role="img"
                            aria-label={`Share of the best price total of the ${items.length} most expensive rows`}
                        >
                            {slices.map((slice, index) => {
                                const className =
                                    active && active !== slice.key
                                        ? "cost-slice dimmed"
                                        : "cost-slice";
                                const at =
                                    slice.rank === null
                                        ? null
                                        : labelPoint(RING, slice);
                                return (
                                    <g key={slice.key} {...hover(slice.key)}>
                                        <title>{title(index)}</title>
                                        {slice.share > 0.9999 ? (
                                            // One row: a whole ring.
                                            <circle
                                                className={className}
                                                cx={RING.cx}
                                                cy={RING.cy}
                                                r={
                                                    (RING.outer + RING.inner) /
                                                    2
                                                }
                                                fill="none"
                                                stroke={slice.fill}
                                                strokeWidth={
                                                    RING.outer - RING.inner
                                                }
                                            />
                                        ) : (
                                            <path
                                                className={className}
                                                fill={slice.fill}
                                                d={segmentPath(
                                                    RING,
                                                    slice.start,
                                                    slice.end
                                                )}
                                            />
                                        )}
                                        {at && (
                                            <text
                                                className="cost-slice-label"
                                                x={at.x}
                                                y={at.y}
                                                fill={slice.label}
                                            >
                                                {slice.rank}
                                            </text>
                                        )}
                                    </g>
                                );
                            })}
                            <text
                                className="cost-center-value"
                                x={RING.cx}
                                y={RING.cy - 4}
                            >
                                {MONEY.format(total)}
                            </text>
                            <text
                                className="cost-center-unit"
                                x={RING.cx}
                                y={RING.cy + 16}
                            >
                                {BASE_CURRENCY} total
                            </text>
                        </svg>
                        <table className="mapping cost-table">
                            <thead>
                                <tr>
                                    <th className="number">#</th>
                                    <th>Reference</th>
                                    <th>Value</th>
                                    <th>Best price at</th>
                                    <th className="number">
                                        Total ({BASE_CURRENCY})
                                    </th>
                                    <th className="number">Share</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item, index) => (
                                    <tr
                                        key={item.rowId}
                                        className={
                                            active === item.rowId
                                                ? "active"
                                                : undefined
                                        }
                                        {...hover(item.rowId)}
                                    >
                                        <td className="number">
                                            <span
                                                className="cost-swatch"
                                                style={{
                                                    background:
                                                        slices[index]!.fill
                                                }}
                                            />
                                            {index + 1}
                                        </td>
                                        <td
                                            className="cost-text"
                                            title={item.reference}
                                        >
                                            {item.reference}
                                        </td>
                                        <td
                                            className="cost-text"
                                            title={item.value}
                                        >
                                            {item.value}
                                        </td>
                                        <td>{item.supplier}</td>
                                        <td className="number">
                                            {MONEY.format(item.total)}
                                        </td>
                                        <td className="number">
                                            {PERCENT.format(item.share)}
                                        </td>
                                    </tr>
                                ))}
                                {other && (
                                    <tr
                                        className={
                                            active === "other"
                                                ? "active"
                                                : undefined
                                        }
                                        {...hover("other")}
                                    >
                                        <td className="number">
                                            <span className="cost-swatch other" />
                                        </td>
                                        <td colSpan={3}>
                                            Other {other.rows}{" "}
                                            {other.rows === 1 ? "row" : "rows"}
                                        </td>
                                        <td className="number">
                                            {MONEY.format(other.total)}
                                        </td>
                                        <td className="number">
                                            {PERCENT.format(other.share)}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <p className="muted">
                        Each row at the supplier with its best price for the
                        build quantity, as in the Best price columns. Rows
                        without a supplier that has enough stock aren&apos;t
                        included.
                    </p>
                </>
            )}
        </Modal>
    );
}
