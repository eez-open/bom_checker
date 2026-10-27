import type { Project } from "../shared/model";
import {
    manualSuppliersWithPrices,
    suppliersWithData
} from "../shared/project-ops";
import { SUPPLIERS } from "../shared/suppliers";
import { clearFilters, SEARCH_INPUT_ID, toggleColumns } from "./commands";
import { useUi, type TableGroup } from "./store/ui";

/** The column groups of this BOM's table, in table order. */
export function tableGroups(
    project: Project
): { id: TableGroup; name: string }[] {
    const priced =
        suppliersWithData(project).length +
        manualSuppliersWithPrices(project).length;
    return [
        ...project.suppliers.map(supplier => ({
            id: supplier,
            name: SUPPLIERS[supplier].name
        })),
        ...project.manualSuppliers.map(supplier => ({
            id: `manual:${supplier.id}` as const,
            name: supplier.name
        })),
        // The table shows Best price once two suppliers have prices.
        ...(priced >= 2 ? [{ id: "best" as const, name: "Best price" }] : [])
    ];
}

/** The rows filters offered for this BOM, as value → label. */
export function rowViews(project: Project): [string, string][] {
    const withData = suppliersWithData(project);
    const manual = manualSuppliersWithPrices(project);
    if (withData.length + manual.length === 0) {
        return [];
    }
    return [
        ["all", "All rows"],
        ...withData.map((supplier): [string, string] => [
            `best:${supplier}`,
            `Best price: ${SUPPLIERS[supplier].name}`
        ]),
        ...manual.map((supplier): [string, string] => [
            `best:${supplier.id}`,
            `Best price: ${supplier.name}`
        ]),
        ["none", "Best price: None in stock"]
    ];
}

/** Search (Ctrl+F), the rows filter and which column groups show (#5),
 *  above the table. */
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
    const hidden = useUi(state => state.hiddenColumns);
    const views = rowViews(project);
    const groups = tableGroups(project);

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
            {groups.length > 0 && (
                <span
                    className="filter-columns"
                    role="group"
                    aria-label="Shown columns"
                >
                    Columns
                    {groups.map(group => (
                        <label key={group.id}>
                            <input
                                type="checkbox"
                                checked={!hidden.includes(group.id)}
                                onChange={() => toggleColumns(group.id)}
                            />
                            {group.name}
                        </label>
                    ))}
                </span>
            )}
        </div>
    );
}
