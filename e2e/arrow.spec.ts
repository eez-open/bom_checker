import { expect, test } from "@playwright/test";
import { startFakeSuppliers } from "./fake-suppliers";
import {
    cell,
    closeApp,
    fillEditor,
    launchApp,
    setUpCredentials
} from "./helpers";

test("collects from Arrow's inventory sources (#62)", async () => {
    const fake = await startFakeSuppliers();
    const { app, page } = await launchApp({
        env: { EEZ_BOM_CHECKER_API_URLS: JSON.stringify(fake.urls) }
    });
    try {
        await setUpCredentials(page);

        // Europe is chosen at first; Asia too.
        await page.getByRole("button", { name: "Settings…" }).click();
        const settings = page.getByRole("dialog", { name: "Settings" });
        await settings.getByRole("tab", { name: "Suppliers" }).click();
        await settings
            .getByLabel("Password", { exact: true })
            .fill("correct horse");
        await settings.getByRole("button", { name: "Unlock" }).click();
        await settings
            .getByRole("button", { name: "Arrow", exact: true })
            .click();
        const sources = settings.getByRole("group", {
            name: "Inventory sources"
        });
        await expect(
            sources.getByRole("checkbox", { name: "Arrow Europe (EUROPE)" })
        ).toBeChecked();
        await sources
            .getByRole("checkbox", { name: "Arrow Asia (ASIA)" })
            .check();
        await settings
            .getByRole("button", { name: "Save Arrow settings" })
            .click();
        await expect(settings.getByText("Saved.")).toBeVisible();
        await settings.getByRole("button", { name: "Test connection" }).click();
        await expect(settings.getByRole("status")).toContainText(
            "Connected to Arrow (EUROPE)."
        );
        await settings.getByRole("button", { name: "Close" }).click();

        await page.getByRole("button", { name: "New", exact: true }).click();
        await page.getByRole("button", { name: "Add row" }).click();
        await fillEditor(page, "reference", "D1, D2");
        await page.keyboard.press("Tab");
        await fillEditor(page, "value", "BAV99");
        await page.keyboard.press("Tab");
        await fillEditor(page, "qty", "2");
        await page.keyboard.press("Enter");

        // A column for each source chosen; not for the others.
        await page.getByRole("button", { name: "Columns…" }).click();
        const columns = page.getByRole("dialog", { name: "Columns" });
        await columns.getByLabel("Arrow (EUROPE)").check();
        await columns.getByLabel("Arrow (ASIA)").check();
        await expect(columns.getByLabel("Arrow (ACNA)")).toHaveCount(0);
        await columns.getByRole("button", { name: "Close" }).click();
        // Typed for Europe only: Asia looks it up too.
        await cell(page, 0, "pn:arrow-europe").dblclick();
        await fillEditor(page, "pn:arrow-europe", "BAV99");
        await page.keyboard.press("Enter");

        await page.getByRole("button", { name: "Collect…" }).click();
        const collect = page.getByRole("dialog", {
            name: "Collect supplier data"
        });
        await expect(
            collect.getByRole("checkbox", { name: "Arrow (EUROPE)" })
        ).toBeChecked();
        await expect(
            collect.getByRole("checkbox", {
                name: "Look up the Value where a part number is missing"
            })
        ).not.toBeChecked();
        await expect(
            collect.getByRole("checkbox", { name: "Arrow (ASIA)" })
        ).toBeChecked();
        await collect.getByRole("button", { name: "Start" }).click();
        const asia = collect.getByRole("region", {
            name: "Arrow (ASIA) summary"
        });
        await expect(asia).toContainText(
            "From another Arrow source's column: 1 filled in"
        );
        await collect.getByRole("button", { name: "Close" }).click();
        // Found: the cell has the ✓ of collected data.
        await expect(cell(page, 0, "pn:arrow-asia")).toHaveText("✓BAV99");

        // Each source with its own stock and prices; Asia's are in USD.
        await expect(cell(page, 0, "data:arrow-europe:stockQty")).toHaveText(
            "5,000"
        );
        await expect(cell(page, 0, "data:arrow-europe:totalPrice")).toHaveText(
            "0.10"
        );
        await expect(cell(page, 0, "data:arrow-asia:stockQty")).toHaveText(
            "100"
        );
        await expect(page.getByRole("alert")).toContainText(
            "Arrow (ASIA) prices are in USD"
        );
        await expect(cell(page, 0, "best:supplier")).toHaveText(
            "Arrow (EUROPE)"
        );
    } finally {
        await closeApp(app);
        await fake.close();
    }
});
