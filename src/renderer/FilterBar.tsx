import type { Project } from "../shared/model";
import { suppliersWithData } from "../shared/project-ops";
import { SUPPLIERS } from "../shared/suppliers";
import { clearFilters, SEARCH_INPUT_ID } from "./commands";
import { useUi } from "./store/ui";

/** The rows filters offered for this BOM, as value → label. */
export function rowViews(project: Project): [string, string][] {
    const withData = suppliersWithData(project);
    if (withData.length === 0) {
        return [];
    }
    return [
        ["all", "All rows"],
        ...withData.map((supplier): [string, string] => [
            `best:${supplier}`,
            `Best price: ${SUPPLIERS[supplier].name}`
        ]),
        ["none", "Best price: None in stock"]
    ];
}

/** Search (Ctrl+F) and the rows filter, above the table. */
export function FilterBar({
    project,
    rows
}: {
    project: Project;
    /** Rows shown with the filters on; null when nothing is filtered. */
    rows: number | null;
}) {
    const search = useUi(state => state.search);
    const rowView = useUi(state => state.rowView);
    const views = rowViews(project);

    return (
        <div className="filter-bar" role="search">
            <input
                id={SEARCH_INPUT_ID}
                type="search"
                placeholder="Search (Ctrl+F)"
                aria-label="Search the table"
                value={search}
                onChange={event =>
                    useUi.setState({ search: event.target.value })
                }
                onKeyDown={event => {
                    if (event.key === "Escape") {
                        useUi.setState({ search: "" });
                        event.currentTarget.blur();
                    }
                }}
            />
            {views.length > 0 && (
                <label className="filter-rows">
                    Rows
                    <select
                        value={rowView}
                        onChange={event =>
                            useUi.setState({ rowView: event.target.value })
                        }
                    >
                        {views.map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
            )}
            {rows !== null && (
                <span className="muted" data-testid="shown-rows">
                    Showing {rows} of {project.rows.length} rows{" "}
                    <button
                        type="button"
                        className="link"
                        onClick={clearFilters}
                    >
                        Show all
                    </button>
                </span>
            )}
        </div>
    );
}
