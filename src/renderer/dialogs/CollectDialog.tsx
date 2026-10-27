import { useEffect, useId, useRef, useState } from "react";
import {
    formatDateTime,
    lastCollectedAt,
    partNumbersToCollect,
    summarizeRun,
    supplierWork,
    valueMatches,
    type CollectMode,
    type CollectScope,
    type SupplierWork,
    type ValueMatches
} from "../../shared/collection";
import type {
    CollectEvent,
    CollectJob,
    SupplierReadiness
} from "../../shared/ipc";
import {
    partNumberKey,
    type CollectionRun,
    type LookupResult,
    type SupplierId
} from "../../shared/model";
import { setCell } from "../../shared/project-ops";
import { SUPPLIERS } from "../../shared/suppliers";
import { openSettings } from "../commands";
import { errorMessage } from "../errors";
import { useDocument } from "../store/document";
import { useUi } from "../store/ui";
import { Modal } from "./Modal";

type Readiness = Record<SupplierId, SupplierReadiness>;

type Step =
    | { kind: "checking" }
    | { kind: "no-password" }
    | { kind: "locked" }
    | { kind: "choose"; readiness: Readiness }
    | { kind: "running"; jobs: CollectJob[] }
    | {
          kind: "done";
          jobs: CollectJob[];
          /** What the Value lookups found, when that option was on. */
          values?: Partial<Record<SupplierId, ValueMatches>>;
      };

const BY_VALUE_KEY = "collect-by-value";

function loadByValue(): boolean {
    try {
        return localStorage.getItem(BY_VALUE_KEY) === "true";
    } catch {
        return false;
    }
}

function saveByValue(byValue: boolean): void {
    try {
        localStorage.setItem(BY_VALUE_KEY, String(byValue));
    } catch {
        // Only a convenience.
    }
}

interface Progress {
    done: number;
    total: number;
    current: string | null;
}

interface Choice {
    selected: boolean;
    mode: CollectMode;
}

function countFor(work: SupplierWork, mode: CollectMode): number {
    return mode === "all"
        ? work.total
        : mode === "missing"
          ? work.missing
          : work.remaining;
}

/**
 * Puts what the Value lookups of `jobs` found into the empty part-number
 * cells of the rows in `rowIds` (all if not given), as one undo step, and
 * returns the counts per supplier.
 */
function fillFromValues(
    jobs: readonly CollectJob[],
    rowIds: ReadonlySet<string> | undefined
): Partial<Record<SupplierId, ValueMatches>> {
    const { project, applyCollected, edit } = useDocument.getState();
    const matches = Object.fromEntries(
        jobs.map(job => [
            job.supplier,
            valueMatches(project, job.supplier, rowIds)
        ])
    ) as Partial<Record<SupplierId, ValueMatches>>;

    // The result also under the supplier's part number put in the cell.
    applyCollected(collected => {
        const results = { ...collected.results };
        for (const job of jobs) {
            const copies: Record<string, LookupResult> = {};
            for (const { partNumber, result } of matches[job.supplier]!.cells) {
                if (result.status === "found") {
                    copies[partNumberKey(partNumber)] = {
                        ...result,
                        matchedBy: "supplierPartNumber"
                    };
                }
            }
            results[job.supplier] = { ...results[job.supplier], ...copies };
        }
        return { ...collected, results };
    });
    edit(current =>
        jobs.reduce(
            (filled, job) =>
                matches[job.supplier]!.cells.reduce(
                    (next, cell) =>
                        setCell(
                            next,
                            cell.rowId,
                            { kind: "partNumber", supplier: job.supplier },
                            cell.partNumber
                        ),
                    filled
                ),
            current
        )
    );
    return matches;
}

function defaultChoice(
    work: SupplierWork,
    readiness: SupplierReadiness,
    selectedRows: boolean
): Choice {
    if (selectedRows) {
        // Rows are selected to look them up again.
        return {
            selected: readiness.problem === null && work.total > 0,
            mode: "all"
        };
    }
    const mode: CollectMode =
        work.remaining > 0
            ? "continue"
            : work.missing > 0 && work.missing < work.total
              ? "missing"
              : "all";
    // Suppliers whose data is complete aren't selected, so nothing is
    // fetched again by accident; tick one to refresh its data.
    const pending = work.remaining > 0 || work.missing > 0;
    return { selected: readiness.problem === null && pending, mode };
}

function estimateRequests(count: number, readiness: SupplierReadiness): number {
    return Math.ceil(count / readiness.batchSize) * readiness.requestsPerBatch;
}

function formatDuration(run: CollectionRun): string {
    if (!run.endedAt) {
        return "";
    }
    const seconds = Math.round(
        (Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000
    );
    return seconds < 60
        ? `${seconds} s`
        : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** Applies a collection event to the BOM; returns progress updates. */
function applyEvent(event: CollectEvent): void {
    const { applyCollected } = useDocument.getState();
    if (event.type === "results") {
        applyCollected(collected => ({
            ...collected,
            results: {
                ...collected.results,
                [event.supplier]: {
                    ...collected.results[event.supplier],
                    ...event.results
                }
            }
        }));
    } else if (event.type === "supplier-done") {
        applyCollected(collected => ({
            ...collected,
            runs: { ...collected.runs, [event.supplier]: event.run }
        }));
    }
}

export function CollectDialog({ onClose }: { onClose: () => void }) {
    const project = useDocument(state => state.project);
    const [step, setStep] = useState<Step>({ kind: "checking" });
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState<
        Partial<Record<SupplierId, Progress>>
    >({});
    // The jobs being run, and what they cover, for "done".
    const run = useRef<{ jobs: CollectJob[]; scope: CollectScope } | null>(
        null
    );

    const prepare = async () => {
        try {
            setStep({
                kind: "choose",
                readiness: await window.api.collect.prepare()
            });
        } catch (caught) {
            setError(errorMessage(caught));
        }
    };

    useEffect(() => {
        window.api.vault
            .getState()
            .then(async state => {
                if (state === "none") {
                    setStep({ kind: "no-password" });
                } else if (state === "locked") {
                    setStep({ kind: "locked" });
                } else {
                    setStep({
                        kind: "choose",
                        readiness: await window.api.collect.prepare()
                    });
                }
            })
            .catch((caught: unknown) => setError(errorMessage(caught)));
    }, []);

    useEffect(
        () =>
            window.api.collect.onEvent(event => {
                applyEvent(event);
                if (event.type === "progress") {
                    setProgress(current => ({
                        ...current,
                        [event.supplier]: event
                    }));
                } else if (event.type === "done" && run.current) {
                    const { jobs, scope } = run.current;
                    run.current = null;
                    setStep({
                        kind: "done",
                        jobs,
                        values: scope.byValue
                            ? fillFromValues(jobs, scope.rowIds)
                            : undefined
                    });
                }
            }),
        []
    );

    const running = step.kind === "running";
    const close = () => {
        if (!running) {
            onClose();
        }
    };

    return (
        <Modal
            title="Collect supplier data"
            name="collect"
            size="large"
            onClose={close}
            footer={
                running ? (
                    <button
                        type="button"
                        onClick={() => window.api.collect.cancel()}
                    >
                        Cancel
                    </button>
                ) : (
                    <button type="button" onClick={onClose}>
                        Close
                    </button>
                )
            }
        >
            {error && <p className="field-error">{error}</p>}
            {step.kind === "no-password" && (
                <div className="settings-form">
                    <p>
                        Supplier API credentials haven't been set up yet. Enter
                        them in Settings, under Suppliers.
                    </p>
                    <button
                        type="button"
                        className="primary"
                        onClick={openSettings}
                    >
                        Open Settings
                    </button>
                </div>
            )}
            {step.kind === "locked" && (
                <UnlockForm onUnlocked={() => void prepare()} />
            )}
            {step.kind === "choose" && (
                <ChooseSuppliers
                    readiness={step.readiness}
                    onStart={async (jobs, scope) => {
                        const { applyCollected } = useDocument.getState();
                        const startedAt = new Date().toISOString();
                        // A run that is still "running" after a crash can be continued.
                        applyCollected(collected => ({
                            ...collected,
                            runs: {
                                ...collected.runs,
                                ...Object.fromEntries(
                                    jobs.map(job => [
                                        job.supplier,
                                        {
                                            id: job.runId,
                                            startedAt,
                                            state: "running"
                                        }
                                    ])
                                )
                            }
                        }));
                        setProgress({});
                        run.current = { jobs, scope };
                        setStep({ kind: "running", jobs });
                        try {
                            await window.api.collect.start(jobs);
                        } catch (caught) {
                            run.current = null;
                            setError(errorMessage(caught));
                            setStep({ kind: "done", jobs: [] });
                        }
                    }}
                />
            )}
            {(step.kind === "running" || step.kind === "done") &&
                step.jobs.map(job => (
                    <JobStatus
                        key={job.supplier}
                        job={job}
                        progress={progress[job.supplier]}
                        run={project.collected.runs[job.supplier]}
                        finished={step.kind === "done"}
                        values={
                            step.kind === "done"
                                ? step.values?.[job.supplier]
                                : undefined
                        }
                    />
                ))}
        </Modal>
    );
}

function UnlockForm({ onUnlocked }: { onUnlocked: () => void }) {
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);

    return (
        <form
            className="settings-form"
            onSubmit={event => {
                event.preventDefault();
                setChecking(true);
                window.api.vault
                    .unlock(password)
                    .then(ok => {
                        if (ok) {
                            onUnlocked();
                        } else {
                            setError("Wrong password.");
                            setChecking(false);
                        }
                    })
                    .catch((caught: unknown) => {
                        setError(errorMessage(caught));
                        setChecking(false);
                    });
            }}
        >
            <p>
                Enter the password to use the stored API credentials. It's asked
                once per session.
            </p>
            <div className="form-row">
                <label htmlFor="collect-password">Password</label>
                <input
                    id="collect-password"
                    type="password"
                    autoComplete="off"
                    autoFocus
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                />
            </div>
            {error && <p className="field-error">{error}</p>}
            <div className="form-actions">
                <button
                    type="submit"
                    className="primary"
                    disabled={checking || !password}
                >
                    {checking ? "Checking…" : "Unlock"}
                </button>
            </div>
        </form>
    );
}

function ChooseSuppliers({
    readiness,
    onStart
}: {
    readiness: Readiness;
    onStart: (jobs: CollectJob[], scope: CollectScope) => Promise<void>;
}) {
    const project = useDocument(state => state.project);
    const suppliers = project.suppliers;
    const byValueId = useId();
    const [byValue, setByValue] = useState(loadByValue);
    // The rows selected in the table, if any (#17).
    const [selection] = useState(() => {
        const ids = new Set(useUi.getState().selectedRowIds);
        return new Set(
            project.rows.filter(row => ids.has(row.id)).map(row => row.id)
        );
    });
    const [onlySelected, setOnlySelected] = useState(selection.size > 0);
    const scopeOf = (lookUpValues: boolean, selected: boolean) => ({
        byValue: lookUpValues,
        rowIds: selected ? selection : undefined
    });
    const scope = scopeOf(byValue, onlySelected);
    const defaultChoices = (next: CollectScope) =>
        Object.fromEntries(
            suppliers.map(id => [
                id,
                defaultChoice(
                    supplierWork(project, id, next),
                    readiness[id],
                    Boolean(next.rowIds)
                )
            ])
        );
    const [choices, setChoices] = useState<Partial<Record<SupplierId, Choice>>>(
        () => defaultChoices(scope)
    );
    const changeScope = (next: CollectScope) => {
        setChoices(defaultChoices(next));
    };

    if (suppliers.length === 0) {
        return (
            <p>
                The BOM has no supplier part-number columns yet. Add them with
                Columns…, or import a BOM that has them.
            </p>
        );
    }

    const jobs: CollectJob[] = suppliers.flatMap(supplier => {
        const choice = choices[supplier];
        if (!choice?.selected || readiness[supplier].problem) {
            return [];
        }
        const partNumbers = partNumbersToCollect(
            project,
            supplier,
            choice.mode,
            scope
        );
        const runId =
            choice.mode === "continue"
                ? (project.collected.runs[supplier]?.id ?? crypto.randomUUID())
                : crypto.randomUUID();
        return partNumbers.length > 0 ? [{ supplier, runId, partNumbers }] : [];
    });

    return (
        <div className="collect-choose">
            {selection.size > 0 && (
                <div
                    className="collect-modes collect-rows"
                    role="radiogroup"
                    aria-label="Rows"
                >
                    {[true, false].map(selected => (
                        <label key={String(selected)}>
                            <input
                                type="radio"
                                name="collect-rows"
                                checked={onlySelected === selected}
                                onChange={() => {
                                    setOnlySelected(selected);
                                    changeScope(scopeOf(byValue, selected));
                                }}
                            />
                            {selected
                                ? `Only the selected rows (${selection.size})`
                                : `All rows (${project.rows.length})`}
                        </label>
                    ))}
                </div>
            )}
            <div className="collect-by-value">
                <label className="checkbox">
                    <input
                        type="checkbox"
                        checked={byValue}
                        aria-describedby={byValueId}
                        onChange={event => {
                            setByValue(event.target.checked);
                            changeScope(
                                scopeOf(event.target.checked, onlySelected)
                            );
                            saveByValue(event.target.checked);
                        }}
                    />
                    Look up the Value where a part number is missing
                </label>
                <p id={byValueId} className="muted">
                    For rows with an empty part-number cell, the Value is
                    searched as a manufacturer part number, e.g. TPS54331DDA.
                    Generic values such as 100n or 10k are skipped. One match
                    fills in the supplier&apos;s part number; when several items
                    match, the cell gets the Value and you choose the item.
                </p>
            </div>
            {suppliers.map(supplier => (
                <SupplierChoice
                    key={supplier}
                    supplier={supplier}
                    work={supplierWork(project, supplier, scope)}
                    scope={scope}
                    readiness={readiness[supplier]}
                    lastRun={project.collected.runs[supplier]}
                    collectedAt={lastCollectedAt(project.collected, supplier)}
                    choice={choices[supplier]!}
                    onChange={choice =>
                        setChoices(current => ({
                            ...current,
                            [supplier]: choice
                        }))
                    }
                />
            ))}
            <div className="form-actions">
                <button
                    type="button"
                    className="primary"
                    disabled={jobs.length === 0}
                    onClick={() => void onStart(jobs, scope)}
                >
                    Start
                </button>
            </div>
        </div>
    );
}

function SupplierChoice({
    supplier,
    work,
    scope,
    readiness,
    lastRun,
    collectedAt,
    choice,
    onChange
}: {
    supplier: SupplierId;
    work: SupplierWork;
    scope: CollectScope;
    readiness: SupplierReadiness;
    lastRun: CollectionRun | undefined;
    collectedAt: string | null;
    choice: Choice;
    onChange: (choice: Choice) => void;
}) {
    const name = SUPPLIERS[supplier].name;
    const count = countFor(work, choice.mode);
    const requests = estimateRequests(count, readiness);
    const where = scope.rowIds ? "the selected rows" : "the BOM";
    // A run continued for some rows would end as if it had reached all.
    const modes: { mode: CollectMode; label: string; show: boolean }[] = [
        {
            mode: "continue",
            label: `Continue where it stopped (${work.remaining})`,
            show: work.remaining > 0 && !scope.rowIds
        },
        {
            mode: "missing",
            label: `Only part numbers without data (${work.missing})`,
            show: work.missing > 0 && work.missing < work.total
        },
        { mode: "all", label: `All part numbers (${work.total})`, show: true }
    ];

    return (
        <fieldset className="collect-supplier">
            <legend>
                <label>
                    <input
                        type="checkbox"
                        checked={choice.selected && !readiness.problem}
                        disabled={
                            Boolean(readiness.problem) || work.total === 0
                        }
                        onChange={event =>
                            onChange({
                                ...choice,
                                selected: event.target.checked
                            })
                        }
                    />
                    {name}
                </label>
            </legend>
            {readiness.problem ? (
                <p className="field-error">
                    {readiness.problem}{" "}
                    <button
                        type="button"
                        className="link"
                        onClick={openSettings}
                    >
                        Open Settings
                    </button>
                </p>
            ) : work.total === 0 ? (
                <p className="muted">
                    No {name} part numbers in {where}.
                </p>
            ) : (
                <>
                    <p className="muted">
                        {collectedAt
                            ? `Last collected ${formatDateTime(collectedAt)}.`
                            : "Not collected yet."}
                    </p>
                    {lastRun?.state === "interrupted" && lastRun.reason && (
                        <p className="warning">
                            Last time it stopped: {lastRun.reason}
                        </p>
                    )}
                    <div
                        className="collect-modes"
                        role="radiogroup"
                        aria-label={`${name} part numbers`}
                    >
                        {modes
                            .filter(m => m.show)
                            .map(m => (
                                <label key={m.mode}>
                                    <input
                                        type="radio"
                                        name={`mode-${supplier}`}
                                        checked={choice.mode === m.mode}
                                        onChange={() =>
                                            onChange({
                                                ...choice,
                                                mode: m.mode
                                            })
                                        }
                                    />
                                    {m.label}
                                </label>
                            ))}
                    </div>
                    <p className="muted">
                        About {requests}{" "}
                        {requests === 1 ? "request" : "requests"}
                        {readiness.remainingToday !== null &&
                            ` · ${readiness.remainingToday} left today`}
                        {work.flagged > 0 &&
                            ` · ${work.flagged} ${work.flagged === 1 ? "cell lists" : "cells list"} alternatives and ${work.flagged === 1 ? "is" : "are"} skipped`}
                    </p>
                    {readiness.remainingToday !== null &&
                        requests > readiness.remainingToday && (
                            <p className="warning">
                                That's more than today's limit allows.
                                Collecting stops at the limit and can be
                                continued tomorrow.
                            </p>
                        )}
                </>
            )}
            {!readiness.problem && !scope.byValue && work.valueRows > 0 && (
                <p className="muted">
                    {work.valueRows === 1
                        ? "1 row has"
                        : `${work.valueRows} rows have`}{" "}
                    no {name} part number but a Value that can be looked up:
                    turn on &quot;Look up the Value where a part number is
                    missing&quot;.
                </p>
            )}
        </fieldset>
    );
}

function JobStatus({
    job,
    progress,
    run,
    finished,
    values
}: {
    job: CollectJob;
    progress: Progress | undefined;
    run: CollectionRun | undefined;
    finished: boolean;
    values: ValueMatches | undefined;
}) {
    const project = useDocument(state => state.project);
    const name = SUPPLIERS[job.supplier].name;
    const done = progress?.done ?? 0;
    const total = progress?.total ?? job.partNumbers.length;
    const ended =
        run?.id === job.runId && run.state !== "running" ? run : undefined;

    if (!finished || !ended) {
        return (
            <section className="collect-job">
                <h3>{name}</h3>
                <progress
                    value={done}
                    max={Math.max(total, 1)}
                    aria-label={`${name} progress`}
                />
                <p className="muted">
                    {done} of {total}
                    {progress?.current && ` · checking ${progress.current}`}
                </p>
            </section>
        );
    }

    const summary = summarizeRun(project, job.supplier, job.runId);
    return (
        <section className="collect-job" aria-label={`${name} summary`}>
            <h3>
                {name}: {ended.state === "complete" ? "done" : "stopped"} in{" "}
                {formatDuration(ended)}
            </h3>
            {summary.requested > 0 && (
                <>
                    <p>
                        Requested {summary.requested} · found {summary.found} ·
                        not found {summary.notFound}
                        {summary.ambiguous > 0 &&
                            ` · several matches ${summary.ambiguous}`}
                        {summary.errors > 0 && ` · errors ${summary.errors}`}
                    </p>
                    <p>
                        Enough stock for the BOM quantity: {summary.inStock} ·
                        not enough: {summary.notInStock}
                    </p>
                </>
            )}
            {values &&
                values.found + values.ambiguous + values.notFound > 0 && (
                    <p>
                        From the Value: {values.found} filled in ·{" "}
                        {values.ambiguous} to choose · {values.notFound} not
                        found
                    </p>
                )}
            {ended.state === "interrupted" && (
                <p className="warning">
                    Stopped: {ended.reason} Open Collect again to continue where
                    it stopped.
                </p>
            )}
        </section>
    );
}
