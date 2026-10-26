import { useEffect, useState } from "react";
import type { AppInfo } from "../shared/ipc";
import type { BomRow } from "../shared/model";
import { BomTable } from "./table/BomTable";

const NO_ROWS: BomRow[] = [];

export function App() {
    const [info, setInfo] = useState<AppInfo>();

    useEffect(() => {
        window.api.app
            .getInfo()
            .then(setInfo)
            .catch((error: unknown) =>
                console.error("Failed to get app info", error)
            );
    }, []);

    return (
        <div className="app">
            <main className="app-table">
                <BomTable rows={NO_ROWS} />
            </main>
            <footer className="status-bar">
                <span data-testid="app-version">
                    {info ? `v${info.version}` : ""}
                </span>
            </footer>
        </div>
    );
}
