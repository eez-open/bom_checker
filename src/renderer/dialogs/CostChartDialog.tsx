import { useMemo, useState } from "react";
import { fileTitle } from "../../shared/bom-list";
import {
    bomCostBreakdown,
    costBreakdown,
    type BomCostBreakdown,
    type CostBreakdown
} from "../../shared/cost-breakdown";
import { BASE_CURRENCY } from "../../shared/pricing";
import {
    chartPicture,
    describeItem,
    labelPoint,
    pictureToPng,
    segmentPath,
    slicesOf,
    type ChartData,
    type Ring
} from "../cost-chart";
import { errorMessage } from "../errors";
import { WarningIcon } from "../icons";
import { listMembers } from "../list-commands";
import { stockWarnings } from "../../shared/line-text";
import { documentName, useDocument } from "../store/document";
import { useAppSettings, useNumbers } from "../store/settings";
import { useWorkspace } from "../store/workspace";
import type { Numbers } from "../../shared/numbers";
import { Modal } from "./Modal";

// The ring, in SVG units.
const SIZE = 240;
const RING: Ring = { cx: SIZE / 2, cy: SIZE / 2, outer: 116, inner: 70 };

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function unitsText(buildQuantity: number, noun: string): string {
    return buildQuantity > 1 ? ` for ${plural(buildQuantity, noun)}` : "";
}

interface CostChartProps {
    /** The dialog's title. */
    title: string;
    name: string;
    data: ChartData;
    summary: string;
    /** The table's text columns, and each entry's cells. */
    columns: string[];
    cells: string[][];
    /** The picture's legend headers. */
    headers: { label: string; detail: string };
    /** The picture's title, and the file name it's saved as. */
    pictureTitle: string;
    /** What the ring shows, for screen readers. */
    ringLabel: string;
    /** Shown when nothing has a price. */
    empty: string;
    /** Shown below the chart. */
    note: string;
    onClose: () => void;
}

/**
 * A cost chart: a ring with a colour per rank and the rest in gray, beside
 * a table with every number, so the chart is never the only way to read
 * them. It can be copied or saved as a picture.
 */
function CostChart({
    title,
    name,
    data,
    summary,
    columns,
    cells,
    headers,
    pictureTitle,
    ringLabel,
    empty,
    note,
    onClose
}: CostChartProps) {
    const numbers = useNumbers();
    const { money, percent } = numbers;
    // The slice or table row under the pointer.
    const [active, setActive] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const { entries, other, total } = data;
    const slices = slicesOf(data);
    // Rows the total leaves out (#49) or has only in part (#74), as in
    // the Best price header.
    const warnings = stockWarnings(data);
    const warning = warnings.length > 0 && (
        <div data-testid="cost-warning">
            {warnings.map(text => (
                <p key={text} className="cost-warning">
                    <WarningIcon />
                    {text}
                </p>
            ))}
        </div>
    );

    const hover = (key: string) => ({
        onMouseEnter: () => setActive(key),
        onMouseLeave: () => setActive(null)
    });
    const sliceTitle = (index: number) => {
        const entry = entries[index] ?? { ...other!, label: other!.label };
        const rank = index < entries.length ? `${index + 1}. ` : "";
        return `${rank}${entry.label}: ${money(entry.total)} ${BASE_CURRENCY} (${percent(entry.share)})`;
    };

    const png = () =>
        pictureToPng(
            chartPicture(data, headers, pictureTitle, summary, numbers)
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
                pictureTitle.replace(": ", " - ")
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
            title={title}
            name={name}
            size="large"
            onClose={onClose}
            footer={
                <>
                    {message && (
                        <span className="modal-footer-info" role="status">
                            {message}
                        </span>
                    )}
                    {entries.length > 0 && (
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
            {entries.length === 0 ? (
                <>
                    <p>{empty}</p>
                    {warning}
                </>
            ) : (
                <>
                    <p data-testid="cost-summary">{summary}</p>
                    {warning}
                    <div className="cost-chart">
                        <svg
                            viewBox={`0 0 ${SIZE} ${SIZE}`}
                            width={SIZE}
                            height={SIZE}
                            role="img"
                            aria-label={ringLabel}
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
                                        <title>{sliceTitle(index)}</title>
                                        {slice.share > 0.9999 ? (
                                            // One entry: a whole ring.
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
                                {money(total)}
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
                                    {columns.map(column => (
                                        <th key={column}>{column}</th>
                                    ))}
                                    <th className="number">
                                        Total ({BASE_CURRENCY})
                                    </th>
                                    <th className="number">Share</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((entry, index) => (
                                    <tr
                                        key={entry.key}
                                        className={
                                            active === entry.key
                                                ? "active"
                                                : undefined
                                        }
                                        {...hover(entry.key)}
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
                                        {(cells[index] ?? []).map(
                                            (text, column) => (
                                                <td
                                                    key={column}
                                                    className="cost-text"
                                                    title={text}
                                                >
                                                    {text}
                                                </td>
                                            )
                                        )}
                                        <td className="number">
                                            {money(entry.total)}
                                        </td>
                                        <td className="number">
                                            {percent(entry.share)}
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
                                        <td colSpan={columns.length}>
                                            {other.label}
                                        </td>
                                        <td className="number">
                                            {money(other.total)}
                                        </td>
                                        <td className="number">
                                            {percent(other.share)}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <p className="muted">{note}</p>
                </>
            )}
        </Modal>
    );
}

function partsSummary(
    { items, other, total }: CostBreakdown,
    buildQuantity: number,
    { money, percent }: Numbers
): string {
    const units = unitsText(buildQuantity, "unit");
    return other
        ? `The ${items.length} most expensive rows make up ${percent(1 - other.share)} of the best price total, ${money(total)} ${BASE_CURRENCY}${units}.`
        : `Best price total: ${money(total)} ${BASE_CURRENCY}${units}, from ${plural(items.length, "row")} with a price.`;
}

/** The most expensive parts of the BOM at their best price (#28). */
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
    const numbers = useNumbers();
    const breakdown = useMemo(
        () => costBreakdown(project, preference),
        [project, preference]
    );
    const { items, other } = breakdown;
    return (
        <CostChart
            title="Most expensive parts"
            name="cost-chart"
            data={{
                entries: items.map(item => ({
                    key: item.rowId,
                    label: describeItem(item),
                    detail: item.supplier,
                    total: item.total,
                    share: item.share
                })),
                other: other && {
                    ...other,
                    label: `Other ${plural(other.rows, "row")}`
                },
                total: breakdown.total,
                partial: breakdown.partial,
                uncovered: breakdown.uncovered
            }}
            summary={partsSummary(breakdown, project.buildQuantity, numbers)}
            columns={["Reference", "Value", "Best price at"]}
            cells={items.map(item => [
                item.reference,
                item.value,
                item.supplier
            ])}
            headers={{ label: "Reference · Value", detail: "Best price at" }}
            pictureTitle={`${name}: most expensive parts`}
            ringLabel={`Share of the best price total of the ${items.length} most expensive rows`}
            empty="No prices yet. Collect supplier data, or type in the prices of a supplier without an API, to see which parts cost the most."
            note="Each row at the supplier with its best price for the build quantity, as in the Best price columns. A row that no supplier has enough stock for is at the supplier with the most, for what it has; rows that no supplier can deliver any of aren't included."
            onClose={onClose}
        />
    );
}

function bomsSummary(
    { items, other, total }: BomCostBreakdown,
    buildQuantity: number,
    { money, percent }: Numbers
): string {
    const devices = unitsText(buildQuantity, "device");
    return other
        ? `The ${items.length} most expensive BOMs make up ${percent(1 - other.share)} of the Combined BOM's best price total, ${money(total)} ${BASE_CURRENCY}${devices}.`
        : `Combined BOM's best price total: ${money(total)} ${BASE_CURRENCY}${devices}, from ${plural(items.length, "BOM")} with a price.`;
}

/**
 * What each BOM of a list costs when they're ordered together (#54), with
 * the same colours as the most expensive parts.
 */
export function BomCostChartDialog({ onClose }: { onClose: () => void }) {
    const list = useWorkspace(state => state.list);
    // The BOMs as they are now, also the one shown.
    const documents = useWorkspace(state => state.documents);
    const shown = useDocument(state => state.project);
    const preference = useAppSettings(
        state => state.settings.general.supplierOrder
    );
    const numbers = useNumbers();
    const buildQuantity = list?.buildQuantity ?? 1;
    const breakdown = useMemo(
        () => bomCostBreakdown(listMembers(), buildQuantity, preference),
        // listMembers() reads the documents and the BOM shown.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [list, documents, shown, buildQuantity, preference]
    );
    const { items, other } = breakdown;
    const name = list ? fileTitle(list.filePath) : "";
    return (
        <CostChart
            title="Cost by BOM"
            name="bom-costs"
            data={{
                entries: items.map(item => ({
                    key: item.path,
                    label: item.name,
                    detail: `× ${item.perDevice}`,
                    total: item.total,
                    share: item.share
                })),
                other: other && {
                    ...other,
                    label: `Other ${plural(other.boms, "BOM")}`
                },
                total: breakdown.total,
                partial: breakdown.partial,
                uncovered: breakdown.uncovered
            }}
            summary={bomsSummary(breakdown, buildQuantity, numbers)}
            columns={["BOM", "Per device"]}
            cells={items.map(item => [item.name, `× ${item.perDevice}`])}
            headers={{ label: "BOM", detail: "Per device" }}
            pictureTitle={`${name}: cost by BOM`}
            ringLabel={`Share of the Combined BOM's best price total of the ${items.length} most expensive BOMs`}
            empty="No prices yet. Collect supplier data for the BOMs or their Combined BOM, or type in the prices of a supplier without an API, to see what each BOM costs."
            note="The rows of all BOMs as in the Combined BOM, each at its best price for the number of devices; a row that several BOMs use is shared among them by their quantities. A row that no supplier has enough stock for is at the supplier with the most, for what it has; rows that no supplier can deliver any of aren't included."
            onClose={onClose}
        />
    );
}
