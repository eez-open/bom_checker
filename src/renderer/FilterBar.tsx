import type { Project } from "../shared/model";
import {
    manualSuppliersWithPrices,
    suppliersWithData
} from "../shared/project-ops";
import { SUPPLIERS } from "../shared/suppliers";
import {
    clearFilters,
    SEARCH_INPUT_ID,
    toggleColumns,
    toggleTableLayout
} from "./commands";
import { setTableTab, shownTab, useUi, type TableGroup } from "./store/ui";

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

/** The column groups as tabs (#41), above the table: the chosen group's
 *  columns are shown, with the BOM's own columns. */
export function TableTabs({ project }: { project: Project }) {
    const groups = tableGroups(project);
    const tab = shownTab(
        groups,
        useUi(state => state.tableTab)
    );
    return (
        <div className="tabs table-tabs" role="tablist" aria-label="Suppliers">
            {groups.map(group => (
                <button
                    key={group.id}
                    type="button"
                    role="tab"
                    aria-selected={group.id === tab}
                    onClick={() => setTableTab(group.id)}
                >
                    {group.name}
                </button>
            ))}
        </div>
    );
}

/** Search (Ctrl+F), the rows filter and which column groups show (#5),
 *  above the table, or whether they're on tabs (#41). */
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
    const tabs = useUi(state => state.tableLayout === "tabs");
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
                <span className="filter-columns">
                    {!tabs && (
                        <span
                            className="filter-groups"
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
                    <label title="Each supplier's columns, and Best price, on a tab of its own">
                        <input
                            type="checkbox"
                            checked={tabs}
                            onChange={toggleTableLayout}
                        />
                        Tabs
                    </label>
                </span>
            )}
        </div>
    );
}
