import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { app } from "electron";
import type { SecretStatus, VaultState } from "../../shared/ipc";
import { SUPPLIER_IDS, type SupplierId } from "../../shared/model";
import { MIN_PASSWORD_LENGTH } from "../../shared/password";
import { secretFields } from "../../shared/supplier-config";
import { isFileNotFound, writeFileAtomic } from "../files";
import { log } from "../logging";
import {
    changeVaultPassword,
    createVault,
    parseVaultFile,
    readSecrets,
    serializeVaultFile,
    unlockVault,
    writeSecrets,
    type Secrets,
    type VaultFile
} from "./vault-file";

// The credential vault (vault.json) and its state for this session.
//
// - Unlocked once per session: the data key then stays in memory until the
//   app quits or the user locks it.
// - Supplier settings need the password every time they are opened, even
//   when the vault is unlocked. Checking it creates a settings session; its
//   token must accompany every change, so main enforces this, not the UI.

const SETTINGS_SESSION_MS = 30 * 60 * 1000;
// Slows down guessing; scrypt already takes a fraction of a second.
const WRONG_PASSWORD_DELAY_MS = 500;

export class SettingsLockedError extends Error {
    override name = "SettingsLockedError";
    constructor() {
        super("Supplier settings were locked. Enter the password again.");
    }
}

let file: VaultFile | null | undefined; // undefined: not read yet
let dataKey: Buffer | null = null;
let secrets: Secrets | null = null;
const sessions = new Map<string, number>(); // token → expiry time

function vaultPath(): string {
    return join(app.getPath("userData"), "vault.json");
}

async function loadFile(): Promise<VaultFile | null> {
    if (file === undefined) {
        try {
            file = parseVaultFile(await readFile(vaultPath(), "utf8"));
        } catch (error) {
            if (!isFileNotFound(error)) {
                log.error("Can't read the credential vault:", error);
                throw new Error(
                    "The file with the stored credentials is damaged. " +
                        'Use "Forgot the password?" to start over.',
                    { cause: error }
                );
            }
            file = null;
        }
    }
    return file;
}

async function saveFile(next: VaultFile): Promise<void> {
    await writeFileAtomic(vaultPath(), serializeVaultFile(next));
    file = next;
}

function checkNewPassword(password: string): void {
    if (password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
}

function openSession(): string {
    const token = randomUUID();
    sessions.set(token, Date.now() + SETTINGS_SESSION_MS);
    return token;
}

/** Throws SettingsLockedError unless `token` is an open settings session. */
export function checkSession(token: string): void {
    const expiry = sessions.get(token);
    if (!expiry || expiry < Date.now() || !dataKey) {
        sessions.delete(token);
        throw new SettingsLockedError();
    }
    sessions.set(token, Date.now() + SETTINGS_SESSION_MS);
}

export async function getVaultState(): Promise<VaultState> {
    if (!(await loadFile())) {
        return "none";
    }
    return dataKey ? "unlocked" : "locked";
}

/** Creates the vault and opens a settings session. */
export async function createVaultWithPassword(
    password: string
): Promise<string> {
    checkNewPassword(password);
    if (await loadFile()) {
        throw new Error("A password has already been set.");
    }
    const created = await createVault(password);
    await saveFile(created.file);
    dataKey = created.dataKey;
    secrets = {};
    log.info("Credential vault created");
    return openSession();
}

/** Unlocks the vault for this session. False if the password is wrong. */
export async function unlock(password: string): Promise<boolean> {
    const vault = await loadFile();
    if (!vault) {
        return false;
    }
    const key = await unlockVault(vault, password);
    if (!key) {
        await sleep(WRONG_PASSWORD_DELAY_MS);
        return false;
    }
    secrets = readSecrets(vault, key);
    dataKey = key;
    return true;
}

/** Checks the password (always) and opens a settings session. */
export async function openSettings(password: string): Promise<string | null> {
    return (await unlock(password)) ? openSession() : null;
}

export function closeSettings(token: string): void {
    sessions.delete(token);
}

export function getSecretStatus(token: string): SecretStatus {
    checkSession(token);
    return Object.fromEntries(
        SUPPLIER_IDS.map(supplier => [
            supplier,
            Object.fromEntries(
                secretFields(supplier).map(field => [
                    field.key,
                    Boolean(secrets?.[supplier]?.[field.key])
                ])
            )
        ])
    ) as SecretStatus;
}

/** One stored secret, for Show and Copy in supplier settings; null if it
 *  isn't set. */
export function getSecret(
    token: string,
    supplier: SupplierId,
    key: string
): string | null {
    checkSession(token);
    if (!secrets) {
        throw new SettingsLockedError();
    }
    if (!secretFields(supplier).some(field => field.key === key)) {
        throw new Error(`Unknown setting: ${key}`);
    }
    return secrets[supplier]?.[key] ?? null;
}

/** Sets (string) or removes (null) secrets of one supplier. */
export async function saveSecrets(
    token: string,
    supplier: SupplierId,
    changes: Record<string, string | null>
): Promise<void> {
    checkSession(token);
    const vault = await loadFile();
    if (!vault || !dataKey || !secrets) {
        throw new SettingsLockedError();
    }
    const allowed = new Set(secretFields(supplier).map(field => field.key));
    const values = { ...secrets[supplier] };
    for (const [key, value] of Object.entries(changes)) {
        if (!allowed.has(key)) {
            throw new Error(`Unknown setting: ${key}`);
        }
        if (value === null || value.trim() === "") {
            delete values[key];
        } else {
            values[key] = value.trim();
        }
    }
    const next = { ...secrets, [supplier]: values };
    await saveFile(writeSecrets(vault, dataKey, next));
    secrets = next;
}

/**
 * False if `currentPassword` is wrong. The current password proves who
 * asks, so this needs no settings session (it's in Settings → General) and
 * works while the credentials are locked too.
 */
export async function changePassword(
    currentPassword: string,
    newPassword: string
): Promise<boolean> {
    checkNewPassword(newPassword);
    const vault = await loadFile();
    if (!vault) {
        throw new Error("No password has been set yet.");
    }
    const key = await unlockVault(vault, currentPassword);
    if (!key) {
        await sleep(WRONG_PASSWORD_DELAY_MS);
        return false;
    }
    await saveFile(await changeVaultPassword(vault, key, newPassword));
    log.info("Vault password changed");
    return true;
}

/** Secrets of one supplier, for collecting data; null while locked. */
export function getSupplierSecrets(
    supplier: SupplierId
): Record<string, string> | null {
    return secrets ? { ...secrets[supplier] } : null;
}

export function lock(): void {
    dataKey?.fill(0);
    dataKey = null;
    secrets = null;
    sessions.clear();
}

/** Deletes the vault with all stored credentials. */
export async function resetVault(): Promise<void> {
    lock();
    await rm(vaultPath(), { force: true });
    file = null;
    log.info("Credential vault deleted");
}
