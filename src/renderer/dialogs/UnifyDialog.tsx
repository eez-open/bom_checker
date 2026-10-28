import { useMemo, useState } from "react";
import { createStore, useStore } from "zustand";
import { mergeCollected } from "../../shared/bom-list";
import { availabilityText } from "../../shared/line-text";
import {
    SUPPLIER_IDS,
    type CollectedData,
    type Project,
    type SupplierId
} from "../../shared/model";
import { BASE_CURRENCY } from "../../shared/pricing";
import { createProject, createRow } from "../../shared/project-ops";
import { SUPPLIERS } from "../../shared/suppliers";
import {
    applyDecisions,
    candidateLine,
    findUnifyGroups,
    suggestDecision,
    type UnifyDecision,
    type UnifyGroup
} from "../../shared/unify";
import { errorMessage } from "../errors";
import {
    applyUnify,
    documentOf,
    listMembers,
    type UnifyResult
} from "../list-commands";
import { useWorkspace } from "../store/workspace";
import { CollectDialog, type CollectTarget } from "./CollectDialog";
import { Modal } from "./Modal";

const QUANTITY = new Intl.NumberFormat("en", { maximumFractionDigits: 6 });
const UNIT_PRICE = new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 5
});
const MONEY = new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

/** A choice in the dialog: keep the cells, use a part number (or Value)
 *  offered, or one typed in. */
type Choice =
    | { kind: "keep" }
    | { kind: "use"; text: string }
    | { kind: "other"; text: string };

type Choices = Record<string, Choice>;

const VALUE = "value";

function choiceKey(group: UnifyGroup, field: SupplierId | typeof VALUE) {
    return `${group.id}|${field}`;
}

function suggestedChoices(
    groups: readonly UnifyGroup[],
    collected: CollectedData
): Choices {
    const choices: Choices = {};
    for (const group of groups) {
        const decision = suggestDecision(group, collected);
        choices[choiceKey(group, VALUE)] =
            decision.value === null
                ? { kind: "keep" }
                : { kind: "use", text: decision.value };
        for (const [supplier, partNumber] of Object.entries(
            decision.suppliers
        ) as [SupplierId, string | null][]) {
            choices[choiceKey(group, supplier)] =
                partNumber === null
                    ? { kind: "keep" }
                    : { kind: "use", text: partNumber };
        }
    }
    return choices;
}

function chosenText(choice: Choice | undefined): string | null {
    return choice && choice.kind !== "keep" && choice.text.trim()
        ? choice.text.trim()
        : null;
}

function decisionsOf(
    groups: readonly UnifyGroup[],
    choices: Choices
): Map<string, UnifyDecision> {
    return new Map(
        groups.map(group => [
            group.id,
            {
                value: chosenText(choices[choiceKey(group, VALUE)]),
                suppliers: Object.fromEntries(
                    Object.keys(group.suppliers).map(supplier => [
                        supplier,
                        chosenText(
                            choices[choiceKey(group, supplier as SupplierId)]
                        )
                    ])
                )
            }
        ])
    );
}

/** Every part number offered or typed in, as rows of a project, so the
 *  Collect dialog can collect them; their data stays in the dialog. */
function candidateRows(
    groups: readonly UnifyGroup[],
    choices: Choices
): Pick<Project, "rows" | "suppliers"> {
    const rows = [];
    const suppliers = new Set<SupplierId>();
    for (const group of groups) {
        for (const [supplier, candidates] of Object.entries(
            group.suppliers
        ) as [SupplierId, UnifyGroup["suppliers"][SupplierId] & {}][]) {
            suppliers.add(supplier);
            const typed = choices[choiceKey(group, supplier)];
            const partNumbers = [
                ...candidates.map(candidate => candidate.partNumber),
                ...(typed?.kind === "other" ? [typed.text] : [])
            ];
            for (const partNumber of partNumbers) {
                rows.push(
                    createRow({
                        qty: group.totalQty,
                        partNumbers: { [supplier]: partNumber }
                    })
                );
            }
        }
    }
    return {
        rows,
        suppliers: SUPPLIER_IDS.filter(supplier => suppliers.has(supplier))
    };
}

interface Session {
    project: Project;
    applyCollected: (
        change: (collected: CollectedData) => CollectedData
    ) => void;
    edit: () => void;
    readOnly: true;
}

function usedInText(group: UnifyGroup): string {
    const byBom = new Map<string, string[]>();
    for (const row of group.rows) {
        byBom.set(row.bomName, [
            ...(byBom.get(row.bomName) ?? []),
            row.reference || "(no reference)"
        ]);
    }
    return [...byBom]
        .map(([name, references]) => `${name}: ${references.join(", ")}`)
        .join(" · ");
}

function SupplierRows({
    group,
    supplier,
    choice,
    collected,
    onChoose
}: {
    group: UnifyGroup;
    supplier: SupplierId;
    choice: Choice | undefined;
    collected: CollectedData;
    onChoose: (choice: Choice) => void;
}) {
    const candidates = group.suppliers[supplier] ?? [];
    const name = `${group.id}|${supplier}`;
    const lines = candidates.map(candidate =>
        candidate.partNumber === "-"
            ? null
            : candidateLine(group, supplier, candidate.partNumber, collected)
    );
    // The lowest total among those in stock for the group's quantity.
    let best = -1;
    lines.forEach((line, index) => {
        const bestTotal = lines[best]?.total;
        if (
            line?.total != null &&
            line.availability?.kind === "in-stock" &&
            (bestTotal == null || line.total < bestTotal)
        ) {
            best = index;
        }
    });
    const other = choice?.kind === "other" ? choice.text : "";

    return (
        <>
            {candidates.map((candidate, index) => {
                const line = lines[index];
                const offer = line?.offer;
                const checked =
                    choice?.kind === "use" &&
                    choice.text === candidate.partNumber;
                return (
                    <tr
                        key={candidate.partNumber}
                        className={checked ? "chosen" : undefined}
                    >
                        <th scope="row">
                            {index === 0 && SUPPLIERS[supplier].name}
                        </th>
                        <td>
                            <label className="unify-choice">
                                <input
                                    type="radio"
                                    name={name}
                                    checked={checked}
                                    onChange={() =>
                                        onChoose({
                                            kind: "use",
                                            text: candidate.partNumber
                                        })
                                    }
                                />
                                {candidate.partNumber === "-"
                                    ? "- (no part)"
                                    : candidate.partNumber}
                            </label>
                            {index === best && (
                                <span className="unify-best">Best price</span>
                            )}
                        </td>
                        <td className="unify-text" title={offer?.description}>
                            {offer
                                ? [
                                      offer.manufacturer,
                                      offer.manufacturerPartNumber
                                  ]
                                      .filter(Boolean)
                                      .join(" ")
                                : ""}
                        </td>
                        <td>
                            {candidate.partNumber === "-"
                                ? ""
                                : line
                                  ? availabilityText(line)
                                  : "Not collected"}
                        </td>
                        <td className="number">
                            {offer ? QUANTITY.format(offer.stockQty) : ""}
                        </td>
                        <td className="number">
                            {line?.orderQty != null
                                ? QUANTITY.format(line.orderQty)
                                : ""}
                        </td>
                        <td className="number">
                            {line?.unitPrice != null
                                ? `${UNIT_PRICE.format(line.unitPrice)}${line.inBaseCurrency ? "" : ` ${offer?.currency}`}`
                                : ""}
                        </td>
                        <td className="number">
                            {line?.total != null
                                ? MONEY.format(line.total)
                                : ""}
                        </td>
                        <td>{candidate.usedIn.join(", ")}</td>
                    </tr>
                );
            })}
            <tr className="unify-other-row">
                <th scope="row" />
                <td colSpan={8}>
                    <label className="unify-choice">
                        <input
                            type="radio"
                            name={name}
                            checked={choice?.kind === "other"}
                            onChange={() =>
                                onChoose({ kind: "other", text: other })
                            }
                        />
                        Other:
                    </label>{" "}
                    <input
                        type="text"
                        className="unify-other"
                        aria-label={`Other ${SUPPLIERS[supplier].name} part number`}
                        value={other}
                        placeholder="Part number"
                        onFocus={() =>
                            choice?.kind !== "other" &&
                            onChoose({ kind: "other", text: other })
                        }
                        onChange={event =>
                            onChoose({
                                kind: "other",
                                text: event.target.value
                            })
                        }
                    />{" "}
                    <label className="unify-choice">
                        <input
                            type="radio"
                            name={name}
                            checked={!choice || choice.kind === "keep"}
                            onChange={() => onChoose({ kind: "keep" })}
                        />
                        Keep as is
                    </label>
                </td>
            </tr>
        </>
    );
}

function GroupSection({
    group,
    choices,
    collected,
    onChoose
}: {
    group: UnifyGroup;
    choices: Choices;
    collected: CollectedData;
    onChoose: (key: string, choice: Choice) => void;
}) {
    const valueKey = choiceKey(group, VALUE);
    const valueChoice = choices[valueKey];
    const otherValue = valueChoice?.kind === "other" ? valueChoice.text : "";
    const suppliers = SUPPLIER_IDS.filter(s => group.suppliers[s]);
    const title = [group.values[0], group.footprint]
        .filter(Boolean)
        .join(" · ");
    return (
        <section className="unify-group" aria-label={title}>
            <h3>
                {group.values[0] || "(no Value)"}
                {group.footprint && (
                    <span className="unify-footprint">{group.footprint}</span>
                )}
                <span className="unify-qty">
                    {QUANTITY.format(group.totalQty)} pcs in {group.rows.length}{" "}
                    rows
                </span>
            </h3>
            <p className="muted unify-used-in">{usedInText(group)}</p>
            <div
                className="unify-values"
                role="radiogroup"
                aria-label={`Value of ${title}`}
            >
                Value:
                {/* One Value only: it can still be changed with Other. */}
                {(group.values.length > 1 ? group.values : []).map(value => (
                    <label key={value} className="unify-choice">
                        <input
                            type="radio"
                            name={valueKey}
                            checked={
                                valueChoice?.kind === "use" &&
                                valueChoice.text === value
                            }
                            onChange={() =>
                                onChoose(valueKey, { kind: "use", text: value })
                            }
                        />
                        {value}
                    </label>
                ))}
                <label className="unify-choice">
                    <input
                        type="radio"
                        name={valueKey}
                        checked={valueChoice?.kind === "other"}
                        onChange={() =>
                            onChoose(valueKey, {
                                kind: "other",
                                text: otherValue
                            })
                        }
                    />
                    Other:
                </label>
                <input
                    type="text"
                    className="unify-other"
                    aria-label={`Other Value of ${title}`}
                    value={otherValue}
                    placeholder="Value"
                    onChange={event =>
                        onChoose(valueKey, {
                            kind: "other",
                            text: event.target.value
                        })
                    }
                />
                <label className="unify-choice">
                    <input
                        type="radio"
                        name={valueKey}
                        checked={!valueChoice || valueChoice.kind === "keep"}
                        onChange={() => onChoose(valueKey, { kind: "keep" })}
                    />
                    {group.values.length > 1
                        ? "Keep as is"
                        : `Keep ${group.values[0] || "it empty"}`}
                </label>
            </div>
            {suppliers.length > 0 && (
                <table className="mapping unify-table">
                    <thead>
                        <tr>
                            <th>Supplier</th>
                            <th>Part number</th>
                            <th>Manufacturer part number</th>
                            <th>Availability</th>
                            <th className="number">Stock</th>
                            <th className="number">Order qty</th>
                            <th className="number">Unit price</th>
                            <th className="number">Total ({BASE_CURRENCY})</th>
                            <th>Used in</th>
                        </tr>
                    </thead>
                    <tbody>
                        {suppliers.map(supplier => (
                            <SupplierRows
                                key={supplier}
                                group={group}
                                supplier={supplier}
                                choice={choices[choiceKey(group, supplier)]}
                                collected={collected}
                                onChoose={choice =>
                                    onChoose(choiceKey(group, supplier), choice)
                                }
                            />
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}

function Done({ result }: { result: UnifyResult }) {
    return (
        <div className="settings-form">
            <p role="status">
                Changed {result.rows} {result.rows === 1 ? "row" : "rows"} in{" "}
                {result.boms.length} {result.boms.length === 1 ? "BOM" : "BOMs"}{" "}
                and saved them.
            </p>
            <p className="muted">
                The files from before are in {result.backupFolder}.{" "}
                <button
                    type="button"
                    className="link"
                    onClick={() =>
                        window.api.list.showBackup(result.backupFolder)
                    }
                >
                    Show
                </button>
            </p>
            {result.kicad.length > 0 && (
                <p>
                    {result.kicad.join(", ")}{" "}
                    {result.kicad.length === 1 ? "comes" : "come"} from a KiCad
                    project: select {result.kicad.length === 1 ? "it" : "each"}{" "}
                    and use Update KiCad… to write the part numbers into the
                    schematic.
                </p>
            )}
        </div>
    );
}

/**
 * Tools → Unify Part Numbers… of a BOM list (#35): the components whose
 * part numbers differ between rows, with stock and prices for the quantity
 * of all their rows; Apply writes the choices into the BOMs.
 */
export function UnifyDialog({ onClose }: { onClose: () => void }) {
    const historyPath = useWorkspace(state => state.list?.history ?? null);
    // The BOMs as they were when the dialog opened (they were saved).
    const [members] = useState(listMembers);
    const [history] = useState(
        () => (historyPath && documentOf(historyPath)?.project) || null
    );
    const [session] = useState(() =>
        createStore<Session>()(set => ({
            project: {
                ...createProject(),
                collected: mergeCollected([
                    ...members.map(member => member.project),
                    ...(history ? [history] : [])
                ])
            },
            applyCollected: change =>
                set(state => ({
                    project: {
                        ...state.project,
                        collected: change(state.project.collected)
                    }
                })),
            edit: () => undefined,
            readOnly: true
        }))
    );
    const collected = useStore(session, state => state.project.collected);
    const [matchFootprint, setMatchFootprint] = useState(true);
    const groups = useMemo(
        () => findUnifyGroups(members, history, { matchFootprint }),
        [members, history, matchFootprint]
    );
    const [choices, setChoices] = useState<Choices>(() =>
        suggestedChoices(groups, session.getState().project.collected)
    );
    const [collecting, setCollecting] = useState(false);
    const [step, setStep] = useState<
        | { kind: "choose" }
        | { kind: "applying" }
        | { kind: "done"; result: UnifyResult }
    >({ kind: "choose" });
    const [error, setError] = useState<string | null>(null);

    const changes = useMemo(
        () => applyDecisions(members, groups, decisionsOf(groups, choices)),
        [members, groups, choices]
    );
    const changedRows = [...changes.rows.values()].reduce((a, b) => a + b, 0);

    const target: CollectTarget = useMemo(
        () => ({
            useProject: () => useStore(session, state => state.project),
            get: () => session.getState()
        }),
        [session]
    );

    const openCollect = () => {
        // The part numbers offered and typed in now.
        session.setState(state => ({
            project: { ...state.project, ...candidateRows(groups, choices) }
        }));
        setCollecting(true);
    };

    const apply = async () => {
        const confirmed = await window.api.dialog.confirm({
            message: `Change ${changedRows} ${changedRows === 1 ? "row" : "rows"} in ${changes.projects.size} ${changes.projects.size === 1 ? "BOM" : "BOMs"}?`,
            detail: "The BOM files are saved at once. Copies of them from before are kept in a backup folder next to the list.",
            confirmLabel: "Apply"
        });
        if (!confirmed) {
            return;
        }
        setStep({ kind: "applying" });
        setError(null);
        try {
            setStep({
                kind: "done",
                result: await applyUnify(changes, collected)
            });
        } catch (caught) {
            setError(errorMessage(caught));
            setStep({ kind: "choose" });
        }
    };

    const done = step.kind === "done";
    return (
        <Modal
            title="Unify part numbers"
            name="unify"
            size="full"
            onClose={() => step.kind !== "applying" && onClose()}
            footer={
                done ? (
                    <button type="button" onClick={onClose}>
                        Close
                    </button>
                ) : (
                    <>
                        <span className="modal-footer-info">
                            {changedRows > 0
                                ? `${changedRows} ${changedRows === 1 ? "row" : "rows"} in ${changes.projects.size} ${changes.projects.size === 1 ? "BOM" : "BOMs"} will change`
                                : "Nothing to change"}
                        </span>
                        <button
                            type="button"
                            disabled={step.kind === "applying"}
                            onClick={onClose}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="primary"
                            disabled={
                                changedRows === 0 || step.kind === "applying"
                            }
                            onClick={() => void apply()}
                        >
                            Apply…
                        </button>
                    </>
                )
            }
        >
            {error && <p className="field-error">{error}</p>}
            {done ? (
                <Done result={step.result} />
            ) : (
                <>
                    <div className="unify-header">
                        <p>
                            {groups.length === 0
                                ? "Every component has the same part numbers in all rows of the BOMs."
                                : `${groups.length} ${groups.length === 1 ? "component has" : "components have"} different part numbers or Values in their rows. Stock and prices are for the quantity of all rows.`}
                        </p>
                        <label className="checkbox">
                            <input
                                type="checkbox"
                                checked={matchFootprint}
                                onChange={event => {
                                    const match = event.target.checked;
                                    setMatchFootprint(match);
                                    setChoices(
                                        suggestedChoices(
                                            findUnifyGroups(members, history, {
                                                matchFootprint: match
                                            }),
                                            collected
                                        )
                                    );
                                }}
                            />
                            Same footprint
                        </label>
                        <button
                            type="button"
                            disabled={groups.length === 0}
                            title="Choose the best price in stock for every component"
                            onClick={() =>
                                setChoices(suggestedChoices(groups, collected))
                            }
                        >
                            Choose suggestions
                        </button>
                        <button
                            type="button"
                            disabled={groups.length === 0}
                            onClick={openCollect}
                        >
                            Collect…
                        </button>
                    </div>
                    {groups.map(group => (
                        <GroupSection
                            key={group.id}
                            group={group}
                            choices={choices}
                            collected={collected}
                            onChoose={(key, choice) =>
                                setChoices(current => ({
                                    ...current,
                                    [key]: choice
                                }))
                            }
                        />
                    ))}
                </>
            )}
            {collecting && (
                <CollectDialog
                    target={target}
                    onClose={() => setCollecting(false)}
                />
            )}
        </Modal>
    );
}
