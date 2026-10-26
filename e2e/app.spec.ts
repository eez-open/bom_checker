import { expect, test } from "@playwright/test";
import { closeApp, launchApp } from "./helpers";

const BASE_HEADERS = ["Row", "Reference", "Value", "Qty", "Footprint"];

test("starts and shows an empty BOM", async () => {
    const { app, page } = await launchApp();
    try {
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
