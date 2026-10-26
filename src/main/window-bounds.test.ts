import { describe, expect, it } from "vitest";
import { DEFAULT_WINDOW_STATE, fitToScreens } from "./window-bounds";

const LAPTOP = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND = { x: 1920, y: 0, width: 2560, height: 1400 };

describe("window position", () => {
    it("restores size, position and maximized state", () => {
        const saved = {
            bounds: { x: 2000, y: 100, width: 1600, height: 1000 },
            maximized: true
        };
        expect(fitToScreens(saved, [LAPTOP, SECOND])).toEqual(saved);
    });

    it("drops the position when that screen is gone", () => {
        const saved = {
            bounds: { x: 2000, y: 100, width: 1600, height: 1000 },
            maximized: false
        };
        expect(fitToScreens(saved, [LAPTOP])).toEqual({
            bounds: { width: 1600, height: 1000 },
            maximized: false
        });
    });

    it("shrinks a window larger than the biggest screen, but not below the minimum", () => {
        expect(
            fitToScreens(
                { bounds: { width: 4000, height: 3000 }, maximized: false },
                [LAPTOP]
            ).bounds
        ).toEqual({
            width: 1920,
            height: 1040
        });
        expect(
            fitToScreens(
                { bounds: { width: 300, height: 200 }, maximized: false },
                [LAPTOP]
            ).bounds
        ).toEqual({
            width: 800,
            height: 500
        });
    });

    it("uses the default for missing or damaged data", () => {
        expect(fitToScreens(undefined, [LAPTOP])).toEqual(DEFAULT_WINDOW_STATE);
        expect(fitToScreens({ bounds: { width: "big" } }, [LAPTOP])).toEqual(
            DEFAULT_WINDOW_STATE
        );
    });
});
