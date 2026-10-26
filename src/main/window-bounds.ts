// Where to open the main window: as it was last time, but never off
// screen (e.g. after a monitor was disconnected).

export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface WindowState {
    /** Size and position when not maximized; x and y may be unknown. */
    bounds: Partial<Pick<Rectangle, "x" | "y">> &
        Pick<Rectangle, "width" | "height">;
    maximized: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = {
    bounds: { width: 1280, height: 800 },
    maximized: false
};

const MIN_WIDTH = 800;
const MIN_HEIGHT = 500;
/** How much of the title bar must be on a screen to keep the position. */
const VISIBLE_MARGIN = 100;

/** The saved state, made to fit the screens available now. */
export function fitToScreens(
    saved: unknown,
    workAreas: readonly Rectangle[]
): WindowState {
    const state = parse(saved);
    if (!state) {
        return DEFAULT_WINDOW_STATE;
    }
    const largest = workAreas.reduce<Rectangle | undefined>(
        (best, area) =>
            !best || area.width * area.height > best.width * best.height
                ? area
                : best,
        undefined
    );
    const width = Math.max(
        MIN_WIDTH,
        Math.min(state.bounds.width, largest?.width ?? state.bounds.width)
    );
    const height = Math.max(
        MIN_HEIGHT,
        Math.min(state.bounds.height, largest?.height ?? state.bounds.height)
    );
    const { x, y } = state.bounds;
    const onScreen =
        x !== undefined &&
        y !== undefined &&
        workAreas.some(
            area =>
                x + width - VISIBLE_MARGIN >= area.x &&
                x + VISIBLE_MARGIN <= area.x + area.width &&
                y >= area.y &&
                y + VISIBLE_MARGIN <= area.y + area.height
        );
    return {
        bounds: onScreen ? { x, y, width, height } : { width, height },
        maximized: state.maximized
    };
}

function parse(saved: unknown): WindowState | null {
    if (typeof saved !== "object" || saved === null) {
        return null;
    }
    const { bounds, maximized } = saved as Partial<WindowState>;
    const number = (value: unknown): value is number =>
        typeof value === "number" && Number.isFinite(value);
    if (!bounds || !number(bounds.width) || !number(bounds.height)) {
        return null;
    }
    return {
        bounds: {
            width: bounds.width,
            height: bounds.height,
            ...(number(bounds.x) && number(bounds.y)
                ? { x: bounds.x, y: bounds.y }
                : {})
        },
        maximized: maximized === true
    };
}
