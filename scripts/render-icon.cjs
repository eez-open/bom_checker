// Renders build/icon.svg to build/icon.png with Electron's Chromium, so no
// extra image tools are needed. electron-builder makes the Windows .ico and
// the Linux icon sizes from the PNG.
//
//   npm run icon                          (1024 px)
//   electron scripts/render-icon.cjs <svg> <png> <size>

const { app, BrowserWindow } = require("electron");
const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const [svgPath = "build/icon.svg", pngPath = "build/icon.png", sizeArg] =
    process.argv.slice(2);
const size = Number(sizeArg ?? 1024);

app.disableHardwareAcceleration();

app.whenReady()
    .then(async () => {
        const svg = readFileSync(resolve(svgPath)).toString("base64");
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
        writeFileSync(
            resolve(pngPath),
            image.resize({ width: size, height: size, quality: "best" }).toPNG()
        );
        console.log(`Wrote ${pngPath} (${size}x${size})`);
        app.quit();
    })
    .catch(error => {
        console.error(error);
        app.exit(1);
    });
