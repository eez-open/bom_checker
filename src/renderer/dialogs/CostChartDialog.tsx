import { useMemo, useState } from "react";
import { costBreakdown, type CostItem } from "../../shared/cost-breakdown";
import { BASE_CURRENCY } from "../../shared/pricing";
import { useDocument } from "../store/document";
import { useAppSettings } from "../store/settings";
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
const CENTER = SIZE / 2;
const OUTER = 116;
const INNER = 70;
const MIDDLE = (OUTER + INNER) / 2;
/** Arc length at the middle of the ring that a slice's number needs. */
const LABEL_ROOM = 20;

interface Slice {
    key: string;
    /** 1-based rank; null for Other. */
    rank: number | null;
    share: number;
    title: string;
    /** Angles in radians, clockwise from 12 o'clock. */
    start: number;
    end: number;
}

function point(radius: number, angle: number): string {
    const x = CENTER + radius * Math.cos(angle);
    const y = CENTER + radius * Math.sin(angle);
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
}

/** A ring segment from `start` to `end` (radians, clockwise). */
function segment(start: number, end: number): string {
    const large = end - start > Math.PI ? 1 : 0;
    return (
        `M ${point(OUTER, start)} ` +
        `A ${OUTER} ${OUTER} 0 ${large} 1 ${point(OUTER, end)} ` +
        `L ${point(INNER, end)} ` +
        `A ${INNER} ${INNER} 0 ${large} 0 ${point(INNER, start)} Z`
    );
}

function describe(item: CostItem): string {
    return [item.reference, item.value].filter(Boolean).join(" · ");
}

/**
 * The most expensive parts at their best price (#28): a ring with the
 * top rows in one color and the rest in gray, beside a table with every
 * number, so the chart is never the only way to read them.
 */
export function CostChartDialog({ onClose }: { onClose: () => void }) {
    const project = useDocument(state => state.project);
    const preference = useAppSettings(
        state => state.settings.general.supplierOrder
    );
    const breakdown = useMemo(
        () => costBreakdown(project, preference),
        [project, preference]
    );
    // The slice or table row under the pointer.
    const [active, setActive] = useState<string | null>(null);
    const { items, other, total } = breakdown;

    const parts: Omit<Slice, "start" | "end">[] = [
        ...items.map((item, index) => ({
            key: item.rowId,
            rank: index + 1,
            share: item.share,
            title: `${index + 1}. ${describe(item)}: ${MONEY.format(item.total)} ${BASE_CURRENCY} (${PERCENT.format(item.share)})`
        })),
        ...(other
            ? [
                  {
                      key: "other",
                      rank: null,
                      share: other.share,
                      title: `Other ${other.rows} ${other.rows === 1 ? "row" : "rows"}: ${MONEY.format(other.total)} ${BASE_CURRENCY} (${PERCENT.format(other.share)})`
                  }
              ]
            : [])
    ];
    const ends = parts.map((_, index) =>
        parts
            .slice(0, index + 1)
            .reduce((sum, part) => sum + part.share * 2 * Math.PI, 0)
    );
    const slices: Slice[] = parts.map((part, index) => ({
        ...part,
        start: -Math.PI / 2 + (ends[index - 1] ?? 0),
        end: -Math.PI / 2 + ends[index]!
    }));
    const hover = (key: string) => ({
        onMouseEnter: () => setActive(key),
        onMouseLeave: () => setActive(null)
    });
    const units =
        project.buildQuantity > 1 ? ` for ${project.buildQuantity} units` : "";

    return (
        <Modal
            title="Most expensive parts"
            name="cost-chart"
            size="large"
            onClose={onClose}
            footer={
                <button type="button" onClick={onClose}>
                    Close
                </button>
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
                    <p data-testid="cost-summary">
                        {other
                            ? `The ${items.length} most expensive rows make up ${PERCENT.format(1 - other.share)} of the best price total, ${MONEY.format(total)} ${BASE_CURRENCY}${units}.`
                            : `Best price total: ${MONEY.format(total)} ${BASE_CURRENCY}${units}, from ${items.length} ${items.length === 1 ? "row" : "rows"} with a price.`}
                    </p>
                    <div className="cost-chart">
                        <svg
                            viewBox={`0 0 ${SIZE} ${SIZE}`}
                            width={SIZE}
                            height={SIZE}
                            role="img"
                            aria-label={`Share of the best price total of the ${items.length} most expensive rows`}
                        >
                            {slices.map(slice => {
                                const { start, end } = slice;
                                const middle = (start + end) / 2;
                                const className =
                                    "cost-slice" +
                                    (slice.rank === null ? " other" : "") +
                                    (active && active !== slice.key
                                        ? " dimmed"
                                        : "");
                                return (
                                    <g key={slice.key} {...hover(slice.key)}>
                                        <title>{slice.title}</title>
                                        {slice.share > 0.9999 ? (
                                            // One row: a whole ring.
                                            <circle
                                                className={className}
                                                cx={CENTER}
                                                cy={CENTER}
                                                r={MIDDLE}
                                                strokeWidth={OUTER - INNER}
                                            />
                                        ) : (
                                            <path
                                                className={className}
                                                d={segment(start, end)}
                                            />
                                        )}
                                        {slice.rank !== null &&
                                            (end - start) * MIDDLE >=
                                                LABEL_ROOM && (
                                                <text
                                                    className="cost-slice-label"
                                                    x={
                                                        CENTER +
                                                        MIDDLE *
                                                            Math.cos(middle)
                                                    }
                                                    y={
                                                        CENTER +
                                                        MIDDLE *
                                                            Math.sin(middle)
                                                    }
                                                >
                                                    {slice.rank}
                                                </text>
                                            )}
                                    </g>
                                );
                            })}
                            <text
                                className="cost-center-value"
                                x={CENTER}
                                y={CENTER - 4}
                            >
                                {MONEY.format(total)}
                            </text>
                            <text
                                className="cost-center-unit"
                                x={CENTER}
                                y={CENTER + 16}
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
                                            <span className="cost-swatch" />
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
