import { expect, test } from "@playwright/test";
import { closeApp, launchApp } from "./helpers";

const BASE_HEADERS = ["Row", "Reference", "Value", "Qty", "Footprint"];

test("starts on the start page, then shows an empty BOM", async () => {
    const { app, page } = await launchApp();
    try {
        await expect(page).toHaveTitle("EEZ BOM checker");
        const start = page.getByRole("region", { name: "Start" });
        await expect(
            start.getByRole("button", { name: "Open BOM…" })
        ).toBeVisible();
        await expect(start.getByText("or drop a BOM")).toBeVisible();
        await expect(
            page.getByRole("region", { name: "Recent documents" })
        ).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Add row" })).toHaveCount(
            0
        );

        await page.getByRole("button", { name: "New", exact: true }).click();
        await expect(page).toHaveTitle("Untitled - EEZ BOM checker");

        for (const header of BASE_HEADERS) {
            await expect(
                page.getByRole("columnheader", { name: header, exact: true })
            ).toBeVisible();
        }
        await expect(page.getByText("No components yet.")).toBeVisible();
        await expect(page.getByTestId("bom-summary")).toHaveText(
            "0 rows · 0 parts"
        );
        await expect(page.getByTestId("app-version")).toHaveText(
            /^v\d+\.\d+\.\d+/
        );

        // The renderer reaches main only through `window.api`.
        const exposed = await page.evaluate(() => {
            const scope = globalThis as Record<string, unknown>;
            return {
                require: typeof scope.require,
                process: typeof scope.process,
                api: typeof scope.api
            };
        });
        expect(exposed).toEqual({
            require: "undefined",
            process: "undefined",
            api: "object"
        });
    } finally {
        await closeApp(app);
    }
});
