import { describe, expect, it } from "vitest";
import {
    changeVaultPassword,
    createVault,
    DEFAULT_KDF,
    parseVaultFile,
    readSecrets,
    serializeVaultFile,
    unlockVault,
    writeSecrets,
    type VaultFile
} from "./vault-file";

// Cheap key derivation keeps the tests fast; one test uses the real cost.
const FAST = { N: 1024, r: 8, p: 1 };
const SECRET = "mouser-search-key-1234567890";

async function vaultWithSecret(): Promise<VaultFile> {
    const { file, dataKey } = await createVault("correct horse", FAST);
    return writeSecrets(file, dataKey, { mouser: { apiKey: SECRET } });
}

describe("credential vault", () => {
    it("unlocks with the right password and reads the secrets", async () => {
        const file = await vaultWithSecret();
        const dataKey = await unlockVault(file, "correct horse");
        expect(dataKey).not.toBeNull();
        expect(readSecrets(file, dataKey!)).toEqual({
            mouser: { apiKey: SECRET }
        });
    });

    it("rejects a wrong password", async () => {
        const file = await vaultWithSecret();
        expect(await unlockVault(file, "Correct horse")).toBeNull();
        expect(await unlockVault(file, "")).toBeNull();
    });

    it("never stores secrets or the password in plain text", async () => {
        const text = serializeVaultFile(await vaultWithSecret());
        expect(text).not.toContain(SECRET);
        expect(text).not.toContain("correct horse");
        expect(text).not.toContain(Buffer.from(SECRET).toString("base64"));
    });

    it("survives saving and loading", async () => {
        const file = parseVaultFile(
            serializeVaultFile(await vaultWithSecret())
        );
        const dataKey = await unlockVault(file, "correct horse");
        expect(readSecrets(file, dataKey!).mouser?.apiKey).toBe(SECRET);
    });

    it("detects altered secrets", async () => {
        const file = await vaultWithSecret();
        const dataKey = (await unlockVault(file, "correct horse"))!;
        const data = Buffer.from(file.secrets.data, "base64");
        data[0] = data[0]! ^ 1;
        const altered = {
            ...file,
            secrets: { ...file.secrets, data: data.toString("base64") }
        };
        expect(() => readSecrets(altered, dataKey)).toThrow(/damaged/);
    });

    it("changes the password and keeps the secrets", async () => {
        const file = await vaultWithSecret();
        const dataKey = (await unlockVault(file, "correct horse"))!;
        const changed = await changeVaultPassword(
            file,
            dataKey,
            "battery staple",
            FAST
        );
        expect(await unlockVault(changed, "correct horse")).toBeNull();
        const newKey = (await unlockVault(changed, "battery staple"))!;
        expect(readSecrets(changed, newKey).mouser?.apiKey).toBe(SECRET);
        expect(changed.kdf.salt).not.toBe(file.kdf.salt);
    });

    it("uses scrypt with 128 MiB by default", async () => {
        const { file } = await createVault("correct horse");
        expect(file.kdf).toMatchObject({ name: "scrypt", ...DEFAULT_KDF });
        expect(await unlockVault(file, "correct horse")).not.toBeNull();
    });
});
