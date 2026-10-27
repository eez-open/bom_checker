import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { answerMessageBox, closeApp, launchApp } from "./helpers";

const MOUSER_KEY = "mouser-test-key-7f3a9c";

async function openSupplierSettings(page: Page) {
    await page.getByRole("button", { name: "Settings…" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByRole("tab", { name: "Suppliers" }).click();
    return dialog;
}

test("protects supplier credentials with a password", async () => {
    const { app, page, userData } = await launchApp();
    try {
        // General settings need no password.
        await page.getByRole("button", { name: "Settings…" }).click();
        let dialog = page.getByRole("dialog", { name: "Settings" });
        await dialog.getByRole("button", { name: "Move TME up" }).click();
        await expect(dialog.locator(".supplier-order li span")).toHaveText([
            "DigiKey",
            "TME",
            "Mouser",
            "LCSC"
        ]);
        await dialog.getByRole("button", { name: "Close" }).click();

        // First visit: choose a password.
        dialog = await openSupplierSettings(page);
        const password = dialog.getByLabel("Password", { exact: true });
        const repeat = dialog.getByLabel("Repeat password");
        await password.fill("short");
        await repeat.fill("short");
        await dialog.getByRole("button", { name: "Set password" }).click();
        await expect(
            dialog.getByText("Use at least 8 characters.")
        ).toBeVisible();
        await password.fill("correct horse");
        await repeat.fill("correct horse!");
        await dialog.getByRole("button", { name: "Set password" }).click();
        await expect(
            dialog.getByText("The passwords don't match.")
        ).toBeVisible();
        await repeat.fill("correct horse");
        await dialog.getByRole("button", { name: "Set password" }).click();

        // Enter a Mouser key and a limit.
        await dialog.getByRole("button", { name: "Mouser" }).click();
        const mouserKey = dialog.getByLabel("Search API key", { exact: true });
        await mouserKey.fill(MOUSER_KEY);
        await dialog.getByLabel("Requests per day").fill("abc");
        await expect(dialog.getByText("Enter a whole number.")).toBeVisible();
        await dialog.getByLabel("Requests per day").fill("500");
        await dialog
            .getByRole("button", { name: "Save Mouser settings" })
            .click();
        await expect(dialog.getByText("Saved.")).toBeVisible();
        await expect(mouserKey).toHaveAttribute("placeholder", "Saved");
        await dialog.getByRole("button", { name: "Close" }).click();

        // The key is stored only encrypted.
        const vault = await readFile(join(userData, "vault.json"), "utf8");
        expect(vault).not.toContain(MOUSER_KEY);
        const settingsText = await readFile(
            join(userData, "settings.json"),
            "utf8"
        );
        expect(settingsText).not.toContain(MOUSER_KEY);
        expect(JSON.parse(settingsText)).toMatchObject({
            general: {
                supplierOrder: ["digikey", "tme", "mouser", "lcsc"]
            },
            suppliers: { mouser: { perDay: 500 } }
        });

        // Reopening asks for the password again.
        dialog = await openSupplierSettings(page);
        await dialog.getByLabel("Password", { exact: true }).fill("wrong one");
        await dialog.getByRole("button", { name: "Unlock" }).click();
        await expect(dialog.getByText("Wrong password.")).toBeVisible();
        await dialog
            .getByLabel("Password", { exact: true })
            .fill("correct horse");
        await dialog.getByRole("button", { name: "Unlock" }).click();
        await dialog.getByRole("button", { name: "Mouser" }).click();
        await expect(mouserKey).toHaveAttribute("placeholder", "Saved");
        await expect(mouserKey).toHaveValue("");
        await expect(dialog.getByLabel("Requests per day")).toHaveValue("500");

        // The saved key can be shown and copied; that isn't a change.
        await dialog
            .getByRole("button", { name: "Show Search API key" })
            .click();
        await expect(mouserKey).toHaveValue(MOUSER_KEY);
        await expect(mouserKey).toHaveAttribute("type", "text");
        await dialog
            .getByRole("button", { name: "Copy Search API key" })
            .click();
        await expect(
            dialog.getByRole("button", { name: "Copied" })
        ).toBeVisible();
        expect(
            await app.evaluate(({ clipboard }) => clipboard.readText())
        ).toBe(MOUSER_KEY);
        await expect(
            dialog.getByRole("button", { name: "Save Mouser settings" })
        ).toBeDisabled();
        await dialog
            .getByRole("button", { name: "Hide Search API key" })
            .click();
        await expect(mouserKey).toHaveAttribute("type", "password");

        // Change the password: in General, with the current password.
        await dialog.getByRole("tab", { name: "General" }).click();
        await dialog.getByLabel("Current password").fill("correct horse");
        await dialog
            .getByLabel("New password", { exact: true })
            .fill("battery staple");
        await dialog.getByLabel("Repeat new password").fill("battery staple");
        await dialog.getByRole("button", { name: "Change password" }).click();
        await expect(dialog.getByText("Password changed.")).toBeVisible();
        await dialog.getByRole("button", { name: "Close" }).click();

        dialog = await openSupplierSettings(page);
        await dialog
            .getByLabel("Password", { exact: true })
            .fill("battery staple");
        await dialog.getByRole("button", { name: "Unlock" }).click();
        await expect(
            dialog.getByRole("button", { name: "Save DigiKey settings" })
        ).toBeVisible();
    } finally {
        await closeApp(app);
    }
});

test("starts over when the password is forgotten", async () => {
    const { app, page, userData } = await launchApp();
    try {
        let dialog = await openSupplierSettings(page);
        await dialog
            .getByLabel("Password", { exact: true })
            .fill("first password");
        await dialog.getByLabel("Repeat password").fill("first password");
        await dialog.getByRole("button", { name: "Set password" }).click();
        await expect(
            dialog.getByRole("button", { name: "Save DigiKey settings" })
        ).toBeVisible();
        await dialog.getByRole("button", { name: "Close" }).click();
        await access(join(userData, "vault.json"));

        dialog = await openSupplierSettings(page);
        await answerMessageBox(app, 0); // "Delete"
        await dialog
            .getByRole("button", { name: "Forgot the password?" })
            .click();
        await expect(
            dialog.getByRole("button", { name: "Set password" })
        ).toBeVisible();
        await expect(access(join(userData, "vault.json"))).rejects.toThrow();
    } finally {
        await closeApp(app);
    }
});
