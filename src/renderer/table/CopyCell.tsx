import type { CustomCellRendererProps } from "ag-grid-react";
import type { BomRow } from "../../shared/model";
import { copyToClipboard } from "../commands";
import { CopyIcon } from "../icons";

/** A button that copies a cell's text (#63), shown while the pointer is
 *  over the cell, in views that can't be edited. */
export function CopyButton({ text }: { text: string }) {
    return (
        <button
            type="button"
            className="cell-copy"
            aria-label={`Copy ${text}`}
            title="Copy"
            onClick={event => {
                event.stopPropagation();
                void copyToClipboard(text);
            }}
        >
            <CopyIcon />
        </button>
    );
}

/** A text cell with a copy button (#63), e.g. Value in a list's Combined
 *  BOM. */
export function CopyCell(props: CustomCellRendererProps<BomRow>) {
    const text = props.valueFormatted ?? String(props.value ?? "");
    if (props.node.rowPinned || text === "") {
        return <span>{text}</span>;
    }
    return (
        <span className="copyable">
            <span className="copyable-text">{text}</span>
            <CopyButton text={text} />
        </span>
    );
}
