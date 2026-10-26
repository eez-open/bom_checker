import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import * as XLSX from "xlsx";
import { startFakeSuppliers } from "./fake-suppliers";
import {
    answerOpenDialog,
    closeApp,
    launchApp,
    setUpCredentials
} from "./helpers";

const BOM = join(__dirname, "fixtures/calc-bom.csv");

async function answerSaveDialog(
    app: ElectronApplication,
    extension: string
): Promise<string> {
    const path = join(tmpdir(), `eez-export-${Date.now()}.${extension}`);
    await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = () =>
            Promise.resolve({ canceled: false, filePath });
    }, path);
    return path;
}

test("exports filtered BOM data to xlsx and csv", async () => {
    const fake = await startFakeSuppliers();
    const { app, page, userData } = await launchApp({
        env: { EEZ_BOM_CHECKER_API_URLS: JSON.stringify(fake.urls) }
    });
    try {
        await setUpCredentials(page);
        await answerOpenDialog(app, BOM);
        await page.getByRole("button", { name: "Import CSV…" }).click();
        await page.getByRole("button", { name: "Import", exact: true }).click();
        await page.getByRole("button", { name: "Collect…" }).click();
        const collect = page.getByRole("dialog", {
            name: "Collect supplier data"
        });
        await collect.getByRole("button", { name: "Start" }).click();
        await expect(
            collect.getByRole("region", { name: "TME summary" })
        ).toBeVisible();
        await expect(
            collect.getByRole("region", { name: "Mouser summary" })
        ).toBeVisible();
        await expect(
            collect.getByRole("region", { name: "DigiKey summary" })
        ).toBeVisible();
        await collect.getByRole("button", { name: "Close" }).click();

        // "Best price from Mouser" (the scope's example): only U1.
        await page.getByRole("button", { name: "Export…" }).click();
        let dialog = page.getByRole("dialog", { name: "Export" });
        await dialog
            .getByLabel("Preset", { exact: true })
            .selectOption("Best price from Mouser");
        await expect(dialog.getByText("1 row ·")).toBeVisible();
        const xlsxPath = await answerSaveDialog(app, "xlsx");
        await dialog.getByRole("button", { name: "Export…" }).click();
        await expect(dialog.getByRole("status")).toHaveText(
            `Exported 1 row to ${xlsxPath}`
        );
        await dialog.getByRole("button", { name: "Close" }).click();

        const book = XLSX.read(await readFile(xlsxPath));
        expect(book.SheetNames).toEqual(["BOM", "Info"]);
        const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.BOM!, {
            header: 1
        });
        const headers = rows[0] as string[];
        expect(headers).toContain("Mouser_Total price");
        expect(headers).not.toContain("TME");
        const u1 = rows[1] as unknown[];
        expect(u1[headers.indexOf("Reference")]).toBe("U1");
        expect(u1[headers.indexOf("Best_Supplier")]).toBe("Mouser");
        expect(u1[headers.indexOf("Mouser_Total price")]).toBeCloseTo(6.3);

        // A custom selection saved as a preset, exported as CSV.
        await page.getByRole("button", { name: "Export…" }).click();
        dialog = page.getByRole("dialog", { name: "Export" });
        await dialog
            .getByLabel("Preset", { exact: true })
            .selectOption("All TME data");
        await dialog.getByRole("checkbox", { name: "Best price" }).check();
        await expect(dialog.getByLabel("Preset", { exact: true })).toHaveValue(
            ""
        );
        await dialog.getByLabel("Preset name").fill("TME with best price");
        await dialog.getByRole("button", { name: "Save as preset" }).click();
        await expect(dialog.getByLabel("Preset", { exact: true })).toHaveValue(
            "TME with best price"
        );
        await dialog.getByRole("radio", { name: "CSV (.csv)" }).check();
        const csvPath = await answerSaveDialog(app, "csv");
        await dialog.getByRole("button", { name: "Export…" }).click();
        await expect(dialog.getByRole("status")).toContainText(
            "Exported 1 row"
        );
        await dialog.getByRole("button", { name: "Close" }).click();

        const raw = await readFile(csvPath, "utf8");
        expect(raw.charCodeAt(0)).toBe(0xfeff); // byte order mark, for Excel
        const csv = raw.slice(1);
        const [header, d1] = csv.split("\n");
        expect(header).toContain("TME_Order Qty");
        expect(header).toContain("Best_Total price");
        expect(d1).toContain("1N4007-DIO");
        const settings = JSON.parse(
            await readFile(join(userData, "settings.json"), "utf8")
        ) as {
            general: { exportPresets: { name: string }[] };
        };
        expect(settings.general.exportPresets.map(p => p.name)).toEqual([
            "TME with best price"
        ]);
    } finally {
        await closeApp(app);
        await fake.close();
    }
});
