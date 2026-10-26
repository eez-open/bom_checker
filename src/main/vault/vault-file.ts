// The encrypted credential vault file (vault.json). Pure functions on top of
// Node's crypto, so they're unit-tested without Electron.
//
//   password --scrypt--> password key --AES-256-GCM--> data key (random)
//   data key --AES-256-GCM--> secrets (JSON)
//
// A wrong password fails the GCM authentication of the wrapped data key, so
// no separate password hash is stored. Changing the password re-wraps only
// the data key; the secrets stay encrypted with the same data key.

import {
    createCipheriv,
    createDecipheriv,
    randomBytes,
    scrypt
} from "node:crypto";
import { z } from "zod";

/** Secret values by supplier id, then by field key. */
export type Secrets = Record<string, Record<string, string>>;

export interface KdfParams {
    N: number;
    r: number;
    p: number;
}

/** scrypt with 128 MiB of memory, as recommended by OWASP. */
export const DEFAULT_KDF: KdfParams = { N: 2 ** 17, r: 8, p: 1 };

// Binds each ciphertext to its role, so the two can't be swapped.
const KEY_AAD = Buffer.from("eez-bom-checker vault key v1");
const SECRETS_AAD = Buffer.from("eez-bom-checker vault secrets v1");

const sealedSchema = z.object({
    iv: z.string(),
    data: z.string(),
    tag: z.string()
});
type Sealed = z.infer<typeof sealedSchema>;

const vaultFileSchema = z.object({
    version: z.literal(1),
    kdf: z.object({
        name: z.literal("scrypt"),
        N: z.number().int().min(1024),
        r: z.number().int().min(1),
        p: z.number().int().min(1),
        salt: z.string()
    }),
    key: sealedSchema,
    secrets: sealedSchema
});

export type VaultFile = z.infer<typeof vaultFileSchema>;

const secretsSchema = z.record(z.string(), z.record(z.string(), z.string()));

export function parseVaultFile(text: string): VaultFile {
    return vaultFileSchema.parse(JSON.parse(text));
}

export function serializeVaultFile(file: VaultFile): string {
    return JSON.stringify(file, null, 2) + "\n";
}

/** A new vault with no secrets, and its data key. */
export async function createVault(
    password: string,
    kdf: KdfParams = DEFAULT_KDF
): Promise<{ file: VaultFile; dataKey: Buffer }> {
    const dataKey = randomBytes(32);
    const file: VaultFile = {
        version: 1,
        ...(await wrapDataKey(dataKey, password, kdf)),
        secrets: seal(dataKey, Buffer.from("{}"), SECRETS_AAD)
    };
    return { file, dataKey };
}

/** The data key, or null if the password is wrong. */
export async function unlockVault(
    file: VaultFile,
    password: string
): Promise<Buffer | null> {
    const { salt, N, r, p } = file.kdf;
    const passwordKey = await deriveKey(password, Buffer.from(salt, "base64"), {
        N,
        r,
        p
    });
    return open(passwordKey, file.key, KEY_AAD);
}

export function readSecrets(file: VaultFile, dataKey: Buffer): Secrets {
    const plain = open(dataKey, file.secrets, SECRETS_AAD);
    if (!plain) {
        throw new Error("The credential vault is damaged.");
    }
    return secretsSchema.parse(JSON.parse(plain.toString("utf8")));
}

export function writeSecrets(
    file: VaultFile,
    dataKey: Buffer,
    secrets: Secrets
): VaultFile {
    const plain = Buffer.from(JSON.stringify(secrets), "utf8");
    return { ...file, secrets: seal(dataKey, plain, SECRETS_AAD) };
}

export async function changeVaultPassword(
    file: VaultFile,
    dataKey: Buffer,
    newPassword: string,
    kdf: KdfParams = DEFAULT_KDF
): Promise<VaultFile> {
    return { ...file, ...(await wrapDataKey(dataKey, newPassword, kdf)) };
}

async function wrapDataKey(
    dataKey: Buffer,
    password: string,
    kdf: KdfParams
): Promise<Pick<VaultFile, "kdf" | "key">> {
    const salt = randomBytes(16);
    const passwordKey = await deriveKey(password, salt, kdf);
    return {
        kdf: { name: "scrypt", ...kdf, salt: salt.toString("base64") },
        key: seal(passwordKey, dataKey, KEY_AAD)
    };
}

function deriveKey(
    password: string,
    salt: Buffer,
    { N, r, p }: KdfParams
): Promise<Buffer> {
    return new Promise((resolve, reject) =>
        scrypt(
            password.normalize("NFC"),
            salt,
            32,
            // scrypt needs 128 * N * r bytes; allow twice that.
            { N, r, p, maxmem: 256 * N * r },
            (error, key) => (error ? reject(error) : resolve(key))
        )
    );
}

function seal(key: Buffer, plain: Buffer, aad: Buffer): Sealed {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv).setAAD(aad);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    return {
        iv: iv.toString("base64"),
        data: data.toString("base64"),
        tag: cipher.getAuthTag().toString("base64")
    };
}

/** The plaintext, or null if the key is wrong or the data was altered. */
function open(key: Buffer, sealed: Sealed, aad: Buffer): Buffer | null {
    try {
        const decipher = createDecipheriv(
            "aes-256-gcm",
            key,
            Buffer.from(sealed.iv, "base64")
        )
            .setAAD(aad)
            .setAuthTag(Buffer.from(sealed.tag, "base64"));
        return Buffer.concat([
            decipher.update(Buffer.from(sealed.data, "base64")),
            decipher.final()
        ]);
    } catch {
        return null;
    }
}
