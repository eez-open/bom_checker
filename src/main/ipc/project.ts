import { z } from "zod";
import { IpcChannel } from "../../shared/ipc";
import { validateProject } from "../../shared/project-file";
import { openCsvFile } from "../project/csv-files";
import { openKicadProject } from "../project/kicad-files";
import { openProject, saveProject } from "../project/project-files";
import { handle } from "./handle";

const saveOptionsSchema = z.object({
    filePath: z.string().nullable(),
    saveAs: z.boolean(),
    suggestedName: z.string().optional()
});

export function registerProjectHandlers(): void {
    handle(IpcChannel.ProjectOpen, ({ window }) => openProject(window));
    handle(IpcChannel.ProjectSave, ({ window }, project, options) =>
        saveProject(
            window,
            validateProject(project),
            saveOptionsSchema.parse(options)
        )
    );
    handle(IpcChannel.CsvOpen, ({ window }) => openCsvFile(window));
    handle(IpcChannel.KicadOpen, ({ window }) => openKicadProject(window));
}
