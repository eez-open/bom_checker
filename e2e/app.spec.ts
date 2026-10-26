import { _electron as electron, expect, test } from "@playwright/test";

// Processes started by VS Code extensions inherit ELECTRON_RUN_AS_NODE=1,
// which would make Electron run as plain Node.js instead of starting the app.
function electronEnv(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env).filter(
            (entry): entry is [string, string] =>
                entry[0] !== "ELECTRON_RUN_AS_NODE" && entry[1] !== undefined
        )
    );
}

const BASE_HEADERS = ["Row", "Reference", "Value", "Qty", "Footprint"];

// Starts the built app (`npm run build`), or the packaged executable when
// E2E_APP_PATH is set; CI does the latter after electron-builder has run.
test("starts and shows the empty BOM table", async () => {
    const executablePath = process.env.E2E_APP_PATH;
    const app = await electron.launch({
        ...(executablePath ? { executablePath } : { args: ["."] }),
        env: electronEnv()
    });
    try {
        const page = await app.firstWindow();
        await expect(page).toHaveTitle("EEZ BOM checker");

        for (const header of BASE_HEADERS) {
            await expect(
                page.getByRole("columnheader", { name: header, exact: true })
            ).toBeVisible();
        }
        await expect(page.getByText("No components yet.")).toBeVisible();
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
        await app.close();
    }
});
