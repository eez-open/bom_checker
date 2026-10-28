import { z } from "zod";

/** A PNG image made by the renderer, e.g. a chart (#28). */
export const pngSchema = z
    .instanceof(Uint8Array)
    .refine(png => png.length <= 20_000_000, "The image is too large.");
