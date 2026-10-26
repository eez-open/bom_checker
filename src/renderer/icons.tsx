import type { ReactNode } from "react";

// Small line icons for icon buttons; they take the button's text colour.

function Icon({ children }: { children: ReactNode }) {
    return (
        <svg
            className="icon"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

export function EyeIcon() {
    return (
        <Icon>
            <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
            <circle cx="8" cy="8" r="2" />
        </Icon>
    );
}

export function EyeOffIcon() {
    return (
        <Icon>
            <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
            <circle cx="8" cy="8" r="2" />
            <path d="M2.5 2.5l11 11" />
        </Icon>
    );
}

export function CopyIcon() {
    return (
        <Icon>
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
        </Icon>
    );
}

export function CheckIcon() {
    return (
        <Icon>
            <path d="M3 8.5l3.2 3L13 4.5" />
        </Icon>
    );
}
