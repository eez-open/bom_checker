import { useEffect, useId, useRef, type ReactNode } from "react";

interface ModalProps {
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer: ReactNode;
    size?: "normal" | "large";
}

/** A modal dialog built on the native <dialog> element. It is open while
 *  mounted; Escape calls `onClose`. */
export function Modal({
    title,
    onClose,
    children,
    footer,
    size = "normal"
}: ModalProps) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();

    useEffect(() => {
        const dialog = ref.current;
        dialog?.showModal();
        return () => dialog?.close();
    }, []);

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
