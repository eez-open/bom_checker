import type { BrowserWindow } from "electron";
import { z } from "zod";
import { IpcChannel, type CollectEvent } from "../../shared/ipc";
import { SUPPLIER_IDS } from "../../shared/model";
import { ACCOUNT_IDS } from "../../shared/supplier-config";
import { realClock } from "../collection/clock";
import { CollectionEngine } from "../collection/engine";
import {
    getReadiness,
    openSupplierSession,
    testConnection
} from "../collection/session";
import { log } from "../logging";
import { PLUGINS } from "../suppliers";
import { checkSession } from "../vault/vault";
import { handle, on } from "./handle";

const supplierId = z.enum(SUPPLIER_IDS);
const jobsSchema = z
    .array(
        z.object({
            supplier: supplierId,
            runId: z.string().min(1),
            partNumbers: z.array(z.string().min(1).max(100)).max(5000)
        })
    )
    .max(SUPPLIER_IDS.length);

/** The window that started the current collection; events go there. */
let target: BrowserWindow | null = null;

const engine = new CollectionEngine({
    plugins: PLUGINS,
    openSession: openSupplierSession,
    emit: (event: CollectEvent) => {
        if (target && !target.isDestroyed()) {
            target.webContents.send(IpcChannel.CollectEvent, event);
        }
    },
    clock: realClock
});

export function registerCollectHandlers(): void {
    handle(IpcChannel.CollectPrepare, () => getReadiness());

    handle(IpcChannel.CollectStart, ({ window }, jobs) => {
        const parsed = jobsSchema.parse(jobs);
        if (engine.running) {
            throw new Error("Supplier data is already being collected.");
        }
        target = window;
        // Closing the window cancels the collection.
        window.once("closed", () => engine.cancel());
        log.info(
            "Collecting:",
            parsed
                .map(job => `${job.supplier} ${job.partNumbers.length}`)
                .join(", ")
        );
        engine
            .run(parsed)
            .catch((error: unknown) => log.error("Collection failed:", error));
    });

    on(IpcChannel.CollectCancel, () => engine.cancel());

    handle(IpcChannel.CollectTestConnection, (_context, token, supplier) => {
        checkSession(z.string().parse(token));
        return testConnection(z.enum(ACCOUNT_IDS).parse(supplier));
    });
}
