// Paths shown in files the app writes, without the absolute part (#34).
// Main has node:path; this also runs in the renderer.

function split(path: string): string[] {
    return path.split(/[\\/]+/);
}

/**
 * `target` relative to the folder of `fromFile`, with "/" separators, e.g.
 * "../kicad/board.kicad_pro"; its file name alone when there's no file yet
 * or they're on different drives. Windows paths compare without case.
 */
export function relativeToFile(
    fromFile: string | null,
    target: string
): string {
    const to = split(target);
    const name = to.at(-1) ?? target;
    if (!fromFile) {
        return name;
    }
    const windows = /^[a-z]:/i.test(target) || target.startsWith("\\\\");
    const same = (a: string | undefined, b: string | undefined) =>
        windows ? a?.toLowerCase() === b?.toLowerCase() : a === b;
    const folder = split(fromFile).slice(0, -1);
    if (!same(folder[0], to[0])) {
        return name;
    }
    let common = 0;
    while (
        common < folder.length &&
        common < to.length - 1 &&
        same(folder[common], to[common])
    ) {
        common++;
    }
    return [...folder.slice(common).map(() => ".."), ...to.slice(common)].join(
        "/"
    );
}
