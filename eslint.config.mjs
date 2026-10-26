import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
    globalIgnores([
        "out/",
        "release/",
        "coverage/",
        "test-results/",
        "playwright-report/"
    ]),
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        }
    },
    {
        files: ["**/*.{js,mjs,cjs}"],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: { globals: globals.node }
    },
    {
        files: ["src/main/**", "src/preload/**", "e2e/**", "*.config.{ts,mts}"],
        languageOptions: { globals: globals.node }
    },
    {
        files: ["src/renderer/**"],
        extends: [reactHooks.configs.flat.recommended],
        languageOptions: { globals: globals.browser }
    }
]);
