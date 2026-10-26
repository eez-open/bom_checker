// Renders build/icon.svg to PNG with Electron's Chromium, so no extra
// image tools are needed:
//   build/icon.png           1024 px; electron-builder makes the Windows .ico
//   build/icons/NxN.png      the sizes Linux icon themes look for
//
//   npm run icon

const { app, BrowserWindow } = require("electron");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const source = join(root, "build/icon.svg");
const outputs = [
    { size: 1024, path: join(root, "build/icon.png") },
    ...[16, 24, 32, 48, 64, 128, 256, 512].map(size => ({
        size,
        path: join(root, `build/icons/${size}x${size}.png`)
    }))
];

app.disableHardwareAcceleration();
// Each size gets its own window; don't quit when one closes.
app.on("window-all-closed", () => undefined);

async function render(svg, size) {
    const window = new BrowserWindow({
        width: size,
        height: size,
        useContentSize: true,
        show: false,
        frame: false,
        transparent: true,
        webPreferences: { offscreen: true }
    });
    const html =
        '<body style="margin:0;background:transparent">' +
        `<img src="data:image/svg+xml;base64,${svg}" ` +
        `width="${size}" height="${size}" style="display:block">`;
    await window.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    );
    const image = await window.webContents.capturePage();
    window.destroy();
    return image.resize({ width: size, height: size, quality: "best" }).toPNG();
}

app.whenReady()
    .then(async () => {
        const svg = readFileSync(source).toString("base64");
        mkdirSync(join(root, "build/icons"), { recursive: true });
        for (const { size, path } of outputs) {
            writeFileSync(path, await render(svg, size));
            console.log(`Wrote ${path} (${size}x${size})`);
        }
        app.quit();
    })
    .catch(error => {
        console.error(error);
        app.exit(1);
    });
