import { useState } from "react";

/**
 * A whole number from 1 to `max`, e.g. a build quantity. It's applied on
 * Enter or when leaving the field; anything else goes back to `value`.
 * Give it a `key` of the value, so undo or another BOM resets the text.
 */
export function QuantityInput({
    value,
    max,
    onApply,
    className,
    label
}: {
    value: number;
    max: number;
    onApply: (quantity: number) => void;
    className?: string;
    /** When no <label> wraps it. */
    label?: string;
}) {
    const [text, setText] = useState(String(value));
    const parsed = Number(text.trim());
    const valid = /^\d+$/.test(text.trim()) && parsed >= 1 && parsed <= max;

    const apply = () => {
        if (!valid) {
            setText(String(value));
        } else if (parsed !== value) {
            onApply(parsed);
        }
    };

    return (
        <input
            className={className ? `number ${className}` : "number"}
            inputMode="numeric"
            aria-label={label}
            value={text}
            aria-invalid={!valid}
            onChange={event => setText(event.target.value)}
            onBlur={apply}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    apply();
                } else if (event.key === "Escape") {
                    setText(String(value));
                }
            }}
        />
    );
}
