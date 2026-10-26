import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "e2e",
    timeout: 60_000,
    // Several Electron apps run at once; on a busy machine (CI, WSL) the
    // default of 5 s per expectation is too tight.
    expect: { timeout: 15_000 },
    reporter: process.env.CI ? "github" : "list",
    use: {
        trace: "retain-on-failure"
    }
});
