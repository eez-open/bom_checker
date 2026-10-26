import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { app } from "electron";
import { documentKind } from "../shared/document-kind";
import type { RecentDocument } from "../shared/ipc";
import { writeFileAtomic } from "./files";
import { log } from "./logging";

// Recently opened files (BOMs, and the CSV files and KiCad projects they
// were imported from), newest first. Kept in recent-documents.json in the
// profile folder.

const MAX_RECENT = 10;

let paths: string[] | null = null;
const listeners = new Set<() => void>();

function recentPath(): string {
    return join(app.getPath("userData"), "recent-documents.json");
}

function load(): string[] {
    if (!paths) {
        try {
            const saved = JSON.parse(
                readFileSync(recentPath(), "utf8")
            ) as unknown;
            paths = Array.isArray(saved)
                ? saved
                      .filter(
                          (path): path is string =>
                              typeof path === "string" &&
                              documentKind(path) !== null
                      )
                      .slice(0, MAX_RECENT)
                : [];
        } catch {
            paths = []; // first start, or unreadable
        }
    }
    return paths;
}

/** Windows paths are case-insensitive. */
function samePath(a: string, b: string): boolean {
    return process.platform === "win32"
        ? a.toLowerCase() === b.toLowerCase()
        : a === b;
}

// Writes run one after another, so the newest list is saved last.
let saving = Promise.resolve();

function update(next: string[]): void {
    paths = next;
    saving = saving
        .then(() =>
            writeFileAtomic(recentPath(), JSON.stringify(next, null, 2))
        )
        .catch((error: unknown) =>
            log.warn("Can't save recent documents:", error)
        );
    for (const listener of listeners) {
        listener();
    }
}

export function recentDocuments(): RecentDocument[] {
    return load().map(path => ({
        path,
        name: basename(path),
        kind: documentKind(path)!
    }));
}

export function addRecent(path: string): void {
    const full = resolve(path);
    update(
        [full, ...load().filter(p => !samePath(p, full))].slice(0, MAX_RECENT)
    );
}

export function removeRecent(path: string): void {
    const next = load().filter(p => !samePath(p, path));
    if (next.length !== load().length) {
        update(next);
    }
}

export function clearRecent(): void {
    update([]);
}

/** Calls `listener` after every change; returns an unsubscribe function. */
export function onRecentChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
