import { useEffect, useId, useRef, type ReactNode } from "react";

interface ModalProps {
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer: ReactNode;
    size?: "normal" | "large";
    /** Remembers the size the user gives this dialog, under this name. */
    name?: string;
}

const STORAGE_PREFIX = "dialog-size:";

function savedSize(name: string): { width: number; height: number } | null {
    try {
        const value = JSON.parse(
            localStorage.getItem(STORAGE_PREFIX + name) ?? "null"
        ) as unknown;
        const size = value as { width?: unknown; height?: unknown } | null;
        return typeof size?.width === "number" &&
            typeof size.height === "number"
            ? { width: size.width, height: size.height }
            : null;
    } catch {
        return null;
    }
}

/**
 * A modal dialog built on the native <dialog> element. It is open while
 * mounted; Escape calls `onClose`. It fits its content up to the window
 * size and can be resized from its bottom-right corner; with a `name`, the
 * size is remembered for next time.
 */
export function Modal({
    title,
    onClose,
    children,
    footer,
    size = "normal",
    name
}: ModalProps) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();

    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) {
            return;
        }
        const saved = name ? savedSize(name) : null;
        if (saved) {
            dialog.style.width = `${saved.width}px`;
            dialog.style.height = `${saved.height}px`;
        }
        dialog.showModal();

        // Resizing by the user sets inline sizes; only those are saved, not
        // sizes that follow the content.
        const observer = new ResizeObserver(() => {
            if (name && dialog.style.width && dialog.style.height) {
                try {
                    localStorage.setItem(
                        STORAGE_PREFIX + name,
                        JSON.stringify({
                            width: dialog.offsetWidth,
                            height: dialog.offsetHeight
                        })
                    );
                } catch {
                    // Not worth bothering the user about.
                }
            }
        });
        observer.observe(dialog);
        return () => {
            observer.disconnect();
            dialog.close();
        };
    }, [name]);

    return (
        <dialog
            ref={ref}
            className={size === "large" ? "modal modal-large" : "modal"}
            aria-labelledby={titleId}
            onCancel={event => {
                event.preventDefault();
                onClose();
            }}
        >
            <h2 id={titleId}>{title}</h2>
            <div className="modal-body">{children}</div>
            <div className="modal-footer">{footer}</div>
        </dialog>
    );
}
