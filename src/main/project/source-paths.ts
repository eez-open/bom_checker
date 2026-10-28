import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Project } from "../../shared/model";

// A BOM file keeps the path of the CSV file or KiCad project it was
// imported from relative to its own folder (#34), so files hold no
// absolute paths and a folder can be moved or shared. In the app the path
// is absolute. Files saved before 0.8.0 have absolute paths; they get
// relative ones when saved again.

/** The project as read from `bomPath`, with an absolute source path. */
export function withAbsoluteSource(project: Project, bomPath: string): Project {
    const path = project.source.path;
    return path && !isAbsolute(path)
        ? {
              ...project,
              source: {
                  ...project.source,
                  path: resolve(dirname(bomPath), path)
              }
          }
        : project;
}

/** The project as written to `bomPath`, with a relative source path and
 *  "/" separators. A source on another drive (Windows) has no relative
 *  path and stays absolute. */
export function withRelativeSource(project: Project, bomPath: string): Project {
    const path = project.source.path;
    if (!path || !isAbsolute(path)) {
        return project;
    }
    const relativePath = relative(dirname(bomPath), path);
    return isAbsolute(relativePath)
        ? project
        : {
              ...project,
              source: {
                  ...project.source,
                  path: relativePath.split(sep).join("/")
              }
          };
}
