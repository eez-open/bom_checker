import type { Api } from "../shared/ipc";

declare global {
    interface Window {
        /** Exposed by the preload script; see src/shared/ipc.ts. */
        api: Api;
    }
}

export {};
