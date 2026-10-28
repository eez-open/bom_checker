import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FAKE_CREDENTIALS, startFakeSuppliers } from "./fake-suppliers";
import { answerOpenDialog, cell, closeApp, launchApp } from "./helpers";

const PASSWORD = "correct horse";
const BOM = join(__dirname, "fixtures/small-bom.csv");

async function saveSupplier(
    dialog: Locator,
    supplier: string,
    fields: Record<string, string>
) {
    await dialog.getByRole("button", { name: supplier, exact: true }).click();
    for (const [label, value] of Object.entries(fields)) {
        await dialog.getByLabel(label, { exact: true }).fill(value);
    }
    await dialog
        .getByRole("button", { name: `Save ${supplier} settings` })
        .click();
    await expect(dialog.getByText("Saved.")).toBeVisible();
}

function badge(page: Page, row: number, column: string) {
    return cell(page, row, column).locator(".pn-badge");
}

test("collects supplier data and continues after a daily limit", async () => {
    const fake = await startFakeSuppliers();
    const { app, page, userData } = await launchApp({
        env: { EEZ_BOM_CHECKER_API_URLS: JSON.stringify(fake.urls) }
    });
    try {
        // Credentials.
        await page.getByRole("button", { name: "Settings…" }).click();
        const settings = page.getByRole("dialog", { name: "Settings" });
        await settings.getByRole("tab", { name: "Suppliers" }).click();
        await settings.getByLabel("Password", { exact: true }).fill(PASSWORD);
        await settings.getByLabel("Repeat password").fill(PASSWORD);
        await settings.getByRole("button", { name: "Set password" }).click();
        await saveSupplier(settings, "DigiKey", {
            "Client ID": FAKE_CREDENTIALS.digikey.clientId,
            "Client secret": FAKE_CREDENTIALS.digikey.clientSecret
        });
        await saveSupplier(settings, "Mouser", {
            "Search API key": FAKE_CREDENTIALS.mouser.apiKey
        });
        await settings.getByRole("button", { name: "Test connection" }).click();
        await expect(settings.getByRole("status")).toContainText(
            "Found 595-TPS54331DDA: Texas Instruments TPS54331DDA"
        );
        await saveSupplier(settings, "TME", {
            Token: FAKE_CREDENTIALS.tme.token,
            "App secret": FAKE_CREDENTIALS.tme.appSecret
        });
        // LCSC signs every request; the fake server checks the signature.
        await saveSupplier(settings, "LCSC", {
            Key: FAKE_CREDENTIALS.lcsc.apiKey,
            Secret: FAKE_CREDENTIALS.lcsc.apiSecret
        });
        await settings.getByRole("button", { name: "Test connection" }).click();
        await expect(settings.getByRole("status")).toContainText(
            "Found C2040: Raspberry Pi RP2040"
        );
        await settings.getByRole("button", { name: "Close" }).click();

        // Lock, so collecting asks for the password.
        await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]?.webContents.send(
                "menu:command",
                "lock"
            )
        );

        await answerOpenDialog(app, BOM);
        await page.getByRole("button", { name: "Import CSV…" }).click();
        await page.getByRole("button", { name: "Import", exact: true }).click();
        await expect(page.getByTestId("bom-summary")).toHaveText("4 rows");

        // First run: Mouser stops at its daily limit.
        await page.getByRole("button", { name: "Collect…" }).click();
        const collect = page.getByRole("dialog", {
            name: "Collect supplier data"
        });
        await collect.getByLabel("Password", { exact: true }).fill(PASSWORD);
        await collect.getByRole("button", { name: "Unlock" }).click();
        await expect(
            collect.getByRole("checkbox", { name: "DigiKey" })
        ).toBeChecked();
        await expect(
            collect.getByRole("checkbox", { name: "Mouser" })
        ).toBeChecked();
        await expect(
            collect.getByRole("checkbox", { name: "TME" })
        ).toBeChecked();
        await expect(
            collect.getByRole("checkbox", { name: "LCSC" })
        ).toBeChecked();
        await expect(collect.getByText("Not collected yet.")).toHaveCount(4);
        await collect.getByRole("button", { name: "Start" }).click();

        const summary = (supplier: string) =>
            collect.getByRole("region", { name: `${supplier} summary` });
        await expect(summary("DigiKey")).toContainText(
            "Requested 1 · found 1 · not found 0"
        );
        await expect(summary("TME")).toContainText(
            "Requested 1 · found 1 · not found 0"
        );
        // An LCSC number and a manufacturer part number.
        await expect(summary("LCSC")).toContainText(
            "Requested 2 · found 2 · not found 0"
        );
        await expect(summary("Mouser")).toContainText("stopped");
        await expect(summary("Mouser")).toContainText(
            "Mouser's daily request limit is reached."
        );
        await collect.getByRole("button", { name: "Close" }).click();

        await expect(badge(page, 1, "pn:digikey")).toHaveAttribute(
            "aria-label",
            "Found"
        );
        await expect(badge(page, 2, "pn:tme")).toHaveAttribute(
            "aria-label",
            "Found"
        );
        await expect(badge(page, 0, "pn:mouser")).toHaveCount(0);
        await expect(badge(page, 0, "pn:lcsc")).toHaveAttribute(
            "aria-label",
            "Found"
        );
        await expect(badge(page, 2, "pn:lcsc")).toHaveAttribute(
            "aria-label",
            "Found"
        );
        await expect(
            page
                .locator(".ag-header-group-cell", { hasText: "DigiKey" })
                .locator(".group-header-date")
        ).toHaveText(/^collected \d{4}-\d\d-\d\d \d\d:\d\d$/);

        // Second run: only Mouser has work left, and it continues.
        await page.getByRole("button", { name: "Collect…" }).click();
        await expect(
            collect.getByRole("checkbox", { name: "DigiKey" })
        ).not.toBeChecked();
        await expect(
            collect.getByRole("checkbox", { name: "Mouser" })
        ).toBeChecked();
        await expect(
            collect.getByRole("radio", {
                name: "Continue where it stopped (3)"
            })
        ).toBeChecked();
        await expect(
            collect.getByText(/^Last collected \d{4}-\d\d-\d\d \d\d:\d\d\.$/)
        ).toHaveCount(4);
        await expect(
            collect.getByRole("checkbox", { name: "LCSC" })
        ).not.toBeChecked();
        await collect.getByRole("button", { name: "Start" }).click();
        await expect(summary("Mouser")).toContainText(
            "Requested 3 · found 1 · not found 2"
        );
        await expect(summary("Mouser")).toContainText("done");
        await collect.getByRole("button", { name: "Close" }).click();

        await expect(badge(page, 0, "pn:mouser")).toHaveAttribute(
            "aria-label",
            "Found"
        );
        await expect(badge(page, 1, "pn:mouser")).toHaveAttribute(
            "aria-label",
            "Not found"
        );
        await cell(page, 0, "pn:mouser").hover();
        await expect(page.locator(".ag-tooltip")).toContainText("Stock: 1,027");
        await expect(page.locator(".ag-tooltip")).toContainText("2.1 EUR");
        await expect(page).toHaveTitle("*Untitled - EEZ BOM checker");
        expect(userData).toBeTruthy();
    } finally {
        await closeApp(app);
        await fake.close();
    }
});
