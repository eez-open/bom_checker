import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

// Strict Content Security Policy for the built app. It is added at build time
// only, because the dev server's hot reload relies on inline scripts.
// 'unsafe-inline' styles are needed by AG Grid, which injects its theme CSS.
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
].join("; ");

function contentSecurityPolicy(): Plugin {
    return {
        name: "content-security-policy",
        apply: "build",
        transformIndexHtml: () => [
            {
                tag: "meta",
                attrs: {
                    "http-equiv": "Content-Security-Policy",
                    content: CONTENT_SECURITY_POLICY
                },
                injectTo: "head-prepend"
            }
        ]
    };
}

export default defineConfig({
    main: {},
    preload: {},
    renderer: {
        plugins: [react(), contentSecurityPolicy()]
    }
});
