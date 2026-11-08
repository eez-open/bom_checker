// The cost charts, of the most expensive parts (#28) and of a list's BOMs
// (#54): colours, the ring's geometry, and the picture that is copied or
// saved as PNG.

import type { CostItem } from "../shared/cost-breakdown";
import { stockWarnings } from "../shared/line-text";
import type { Numbers } from "../shared/numbers";
import { BASE_CURRENCY } from "../shared/pricing";
import { WARNING_SIGN } from "./icons";

/**
 * One colour per rank. The reference palette's eight hues plus raspberry
 * and orchid, in an order checked with the data-viz palette validator:
 * every two neighbouring slices, and every slice with the first (where a
 * ring of fewer slices closes), are told apart with each kind of colour
 * blindness (ΔE ≥ 8) and with normal vision (ΔE ≥ 15). Ranks are written
 * on the slices too, so colour never has to carry them alone.
 */
export const CHART_COLORS: readonly { fill: string; label: string }[] = [
    { fill: "#ad1457", label: "#ffffff" },
    { fill: "#2a78d6", label: "#ffffff" },
    { fill: "#eb6834", label: "#0b0b0b" },
    { fill: "#1baf7a", label: "#0b0b0b" },
    { fill: "#eda100", label: "#0b0b0b" },
    { fill: "#e87ba4", label: "#0b0b0b" },
    { fill: "#008300", label: "#ffffff" },
    { fill: "#6250d6", label: "#ffffff" },
    { fill: "#e34948", label: "#0b0b0b" },
    { fill: "#b04fbf", label: "#ffffff" }
];

/** The rest of the BOM: de-emphasised gray. */
export const OTHER_COLOR = "#c3c2b7";

/** Rows left out of the total (#49) or priced for only part (#74), as
 *  the app's error colour. */
const WARNING_COLOR = "#cf222e";

/** What a cost chart shows: its largest parts, a colour each, the rest as
 *  Other, and a legend with two columns of text. */
export interface ChartData {
    entries: ChartEntry[];
    other: { label: string; total: number; share: number } | null;
    total: number;
    /** Rows priced for only what one supplier has (#74). */
    partial: number;
    /** Rows the total leaves out (#49). */
    uncovered: number;
}

export interface ChartEntry {
    key: string;
    /** E.g. "C1 · 100n", or a BOM's name. */
    label: string;
    /** E.g. the supplier with the best price. */
    detail: string;
    total: number;
    share: number;
}

export interface Slice {
    key: string;
    /** 1-based rank; null for Other. */
    rank: number | null;
    share: number;
    fill: string;
    label: string;
    /** Radians, clockwise from 12 o'clock. */
    start: number;
    end: number;
}

/** The entries' slices, then Other's, around the ring. */
export function slicesOf({ entries, other }: ChartData): Slice[] {
    const parts = [
        ...entries.map((item, index) => ({
            key: item.key,
            rank: index + 1,
            share: item.share,
            ...CHART_COLORS[index % CHART_COLORS.length]!
        })),
        ...(other
            ? [
                  {
                      key: "other",
                      rank: null,
                      share: other.share,
                      fill: OTHER_COLOR,
                      label: "#0b0b0b"
                  }
              ]
            : [])
    ];
    let angle = -Math.PI / 2;
    return parts.map(part => {
        const start = angle;
        angle += part.share * 2 * Math.PI;
        return { ...part, start, end: angle };
    });
}

export interface Ring {
    cx: number;
    cy: number;
    outer: number;
    inner: number;
}

function point(ring: Ring, radius: number, angle: number): string {
    const x = ring.cx + radius * Math.cos(angle);
    const y = ring.cy + radius * Math.sin(angle);
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
}

/** The path of a ring segment. */
export function segmentPath(ring: Ring, start: number, end: number): string {
    const large = end - start > Math.PI ? 1 : 0;
    const { outer, inner } = ring;
    return (
        `M ${point(ring, outer, start)} ` +
        `A ${outer} ${outer} 0 ${large} 1 ${point(ring, outer, end)} ` +
        `L ${point(ring, inner, end)} ` +
        `A ${inner} ${inner} 0 ${large} 0 ${point(ring, inner, start)} Z`
    );
}

/** Where a slice's rank goes, or null when the slice is too thin. */
export function labelPoint(
    ring: Ring,
    slice: Slice
): { x: number; y: number } | null {
    const middle = (ring.outer + ring.inner) / 2;
    if ((slice.end - slice.start) * middle < 20) {
        return null;
    }
    const angle = (slice.start + slice.end) / 2;
    return {
        x: ring.cx + middle * Math.cos(angle),
        y: ring.cy + middle * Math.sin(angle)
    };
}

export function describeItem(item: CostItem): string {
    return [item.reference, item.value].filter(Boolean).join(" · ");
}

function escape(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function shorten(text: string, length: number): string {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/**
 * The chart as a picture: the title and summary, the ring, and a legend
 * with every entry's rank, colour, label, detail, total and share, under
 * `headers` for the label and the detail.
 */
export function chartPicture(
    breakdown: ChartData,
    headers: { label: string; detail: string },
    title: string,
    summary: string,
    { money, percent }: Numbers
): { svg: string; width: number; height: number } {
    const width = 780;
    // Lines under the summary for rows priced for only part of their
    // quantity (#74) and rows the total leaves out (#49).
    const warnings = stockWarnings(breakdown);
    const shift = warnings.length * 24;
    const ring: Ring = { cx: 154, cy: 226 + shift, outer: 120, inner: 72 };
    const top = 96 + shift;
    const rowHeight = 24;
    const rows = breakdown.entries.length + (breakdown.other ? 1 : 0);
    const height = Math.max(
        ring.cy + ring.outer + 28,
        top + 28 + rows * rowHeight + 24
    );
    const slices = slicesOf(breakdown);
    const text = (x: number, y: number, content: string, attributes = "") =>
        `<text x="${x}" y="${y}" ${attributes}>${escape(content)}</text>`;

    const parts: string[] = [
        `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
        text(24, 38, title, 'font-size="18" font-weight="600" fill="#1f2328"'),
        text(24, 62, summary, 'font-size="13" fill="#59636e"')
    ];
    const signs = WARNING_SIGN.map(d => `<path d="${d}"/>`).join("");
    warnings.forEach((warning, index) => {
        const y = 74 + index * 24;
        parts.push(
            `<g transform="translate(24 ${y})" fill="none" stroke="${WARNING_COLOR}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${signs}</g>`,
            text(
                46,
                y + 12,
                warning,
                `font-size="13" font-weight="600" fill="${WARNING_COLOR}"`
            )
        );
    });
    for (const slice of slices) {
        parts.push(
            slice.share > 0.9999
                ? `<circle cx="${ring.cx}" cy="${ring.cy}" r="${(ring.outer + ring.inner) / 2}" fill="none" stroke="${slice.fill}" stroke-width="${ring.outer - ring.inner}"/>`
                : `<path d="${segmentPath(ring, slice.start, slice.end)}" fill="${slice.fill}" stroke="#ffffff" stroke-width="2"/>`
        );
        const at = slice.rank === null ? null : labelPoint(ring, slice);
        if (at) {
            parts.push(
                text(
                    at.x,
                    at.y,
                    String(slice.rank),
                    `font-size="12" font-weight="600" fill="${slice.label}" text-anchor="middle" dominant-baseline="central"`
                )
            );
        }
    }
    parts.push(
        text(
            ring.cx,
            ring.cy - 2,
            money(breakdown.total),
            'font-size="22" font-weight="600" fill="#1f2328" text-anchor="middle"'
        ),
        text(
            ring.cx,
            ring.cy + 18,
            `${BASE_CURRENCY} total`,
            'font-size="12" fill="#59636e" text-anchor="middle"'
        )
    );

    // The legend.
    const columns = {
        rank: 336,
        part: 352,
        supplier: 560,
        total: 700,
        share: 756
    };
    const header = 'font-size="12" font-weight="600" fill="#59636e"';
    parts.push(
        text(columns.rank, top, "#", `${header} text-anchor="end"`),
        text(columns.part, top, headers.label, header),
        text(columns.supplier, top, headers.detail, header),
        text(
            columns.total,
            top,
            `Total (${BASE_CURRENCY})`,
            `${header} text-anchor="end"`
        ),
        text(columns.share, top, "Share", `${header} text-anchor="end"`)
    );
    const entries = [
        ...breakdown.entries.map((item, index) => ({
            rank: String(index + 1),
            part: item.label,
            supplier: item.detail,
            total: item.total,
            share: item.share,
            fill: slices[index]!.fill
        })),
        ...(breakdown.other
            ? [
                  {
                      rank: "",
                      part: breakdown.other.label,
                      supplier: "",
                      total: breakdown.other.total,
                      share: breakdown.other.share,
                      fill: OTHER_COLOR
                  }
              ]
            : [])
    ];
    entries.forEach((entry, index) => {
        const y = top + 28 + index * rowHeight;
        const cell = 'font-size="13" fill="#1f2328"';
        parts.push(
            `<rect x="${columns.rank - 30}" y="${y - 10}" width="12" height="12" rx="2" fill="${entry.fill}"/>`,
            text(columns.rank, y, entry.rank, `${cell} text-anchor="end"`),
            text(columns.part, y, shorten(entry.part, 30), cell),
            text(columns.supplier, y, shorten(entry.supplier, 16), cell),
            text(
                columns.total,
                y,
                money(entry.total),
                `${cell} text-anchor="end"`
            ),
            text(
                columns.share,
                y,
                percent(entry.share),
                `${cell} text-anchor="end"`
            )
        );
    });

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
        `viewBox="0 0 ${width} ${height}" font-family="Segoe UI, Ubuntu, Arial, sans-serif">` +
        parts.join("") +
        "</svg>";
    return { svg, width, height };
}

/** The picture as PNG, at twice its size for sharp text. */
export async function pictureToPng(picture: {
    svg: string;
    width: number;
    height: number;
}): Promise<Uint8Array> {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(picture.svg)}`;
    await image.decode();
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = picture.width * scale;
    canvas.height = picture.height * scale;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Can't draw the chart.");
    }
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, picture.width, picture.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
            png =>
                png ? resolve(png) : reject(new Error("Can't draw the chart.")),
            "image/png"
        )
    );
    return new Uint8Array(await blob.arrayBuffer());
}
