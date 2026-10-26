import { useEffect, useId, useState } from "react";
import iconUrl from "../../build/icon.svg";
import type { DocumentKind } from "../shared/document-kind";
import type { RecentDocument } from "../shared/ipc";
import { newDocument, openDocument, openPath } from "./commands";

const KIND_LABELS: Record<DocumentKind, string> = {
    project: "BOM",
    csv: "CSV",
    kicad: "KiCad project"
};

/** Shown while no BOM is open: open one, or pick a recent document. */
export function StartPage({ dragging }: { dragging: boolean }) {
    const [recent, setRecent] = useState<RecentDocument[]>([]);
    const recentId = useId();

    useEffect(() => {
        window.api.recent
            .list()
            .then(setRecent)
            .catch((error: unknown) =>
                console.error("Can't list recent documents", error)
            );
        return window.api.recent.onChange(setRecent);
    }, []);

    return (
        <div className="start-page">
            <section
                className={dragging ? "start-card dragging" : "start-card"}
                aria-label="Start"
            >
                <img src={iconUrl} alt="" width={64} height={64} />
                <h1>EEZ BOM checker</h1>
                <p className="muted">
                    Check stock and prices of your bill of materials at DigiKey,
                    Mouser and TME.
                </p>
                <button
                    type="button"
                    className="primary"
                    onClick={() => void openDocument()}
                >
                    Open BOM…
                </button>
                <p className="muted">
                    or drop a BOM (.eezbom), KiCad project (.kicad_pro) or CSV
                    file here, or{" "}
                    <button
                        type="button"
                        className="link"
                        onClick={() => void newDocument()}
                    >
                        start a new BOM
                    </button>
                </p>
            </section>
            {recent.length > 0 && (
                <section className="recent-card" aria-labelledby={recentId}>
                    <h2 id={recentId}>Recent documents</h2>
                    <ul>
                        {recent.map(document => (
                            <li key={document.path}>
                                <button
                                    type="button"
                                    className="recent-open"
                                    title={`Open ${document.path}`}
                                    onClick={() => void openPath(document.path)}
                                >
                                    <span className="recent-name">
                                        {document.name}
                                        {document.kind !== "project" && (
                                            <span className="recent-kind">
                                                {KIND_LABELS[document.kind]}
                                            </span>
                                        )}
                                    </span>
                                    <span className="recent-path">
                                        {document.path}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    className="recent-remove"
                                    aria-label={`Remove ${document.name} from the list`}
                                    title="Remove from the list"
                                    onClick={() =>
                                        void window.api.recent.remove(
                                            document.path
                                        )
                                    }
                                >
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
