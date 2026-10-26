import { useEffect, useState } from "react";
import {
    partNumbersToCollect,
    summarizeRun,
    supplierWork,
    type CollectMode,
    type SupplierWork
} from "../../shared/collection";
import type {
    CollectEvent,
    CollectJob,
    SupplierReadiness
} from "../../shared/ipc";
import type { CollectionRun, SupplierId } from "../../shared/model";
import { SUPPLIERS } from "../../shared/suppliers";
import { openSettings } from "../commands";
import { errorMessage } from "../errors";
import { useDocument } from "../store/document";
import { Modal } from "./Modal";

type Readiness = Record<SupplierId, SupplierReadiness>;

type Step =
    | { kind: "checking" }
    | { kind: "no-password" }
    | { kind: "locked" }
    | { kind: "choose"; readiness: Readiness }
    | { kind: "running"; jobs: CollectJob[] }
    | { kind: "done"; jobs: CollectJob[] };

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

function defaultChoice(
    work: SupplierWork,
    readiness: SupplierReadiness
): Choice {
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
                } else if (event.type === "done") {
                    setStep(current =>
                        current.kind === "running"
                            ? { kind: "done", jobs: current.jobs }
                            : current
                    );
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
                    onStart={async jobs => {
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
                        setStep({ kind: "running", jobs });
                        try {
                            await window.api.collect.start(jobs);
                        } catch (caught) {
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
    onStart: (jobs: CollectJob[]) => Promise<void>;
}) {
    const project = useDocument(state => state.project);
    const suppliers = project.suppliers;
    const [choices, setChoices] = useState<Partial<Record<SupplierId, Choice>>>(
        () =>
            Object.fromEntries(
                suppliers.map(id => [
                    id,
                    defaultChoice(supplierWork(project, id), readiness[id])
                ])
            )
    );

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
            choice.mode
        );
        const runId =
            choice.mode === "continue"
                ? (project.collected.runs[supplier]?.id ?? crypto.randomUUID())
                : crypto.randomUUID();
        return partNumbers.length > 0 ? [{ supplier, runId, partNumbers }] : [];
    });

    return (
        <div className="collect-choose">
            {suppliers.map(supplier => (
                <SupplierChoice
                    key={supplier}
                    supplier={supplier}
                    work={supplierWork(project, supplier)}
                    readiness={readiness[supplier]}
                    lastRun={project.collected.runs[supplier]}
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
                    onClick={() => void onStart(jobs)}
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
    readiness,
    lastRun,
    choice,
    onChange
}: {
    supplier: SupplierId;
    work: SupplierWork;
    readiness: SupplierReadiness;
    lastRun: CollectionRun | undefined;
    choice: Choice;
    onChange: (choice: Choice) => void;
}) {
    const name = SUPPLIERS[supplier].name;
    const count = countFor(work, choice.mode);
    const requests = estimateRequests(count, readiness);
    const modes: { mode: CollectMode; label: string; show: boolean }[] = [
        {
            mode: "continue",
            label: `Continue where it stopped (${work.remaining})`,
            show: work.remaining > 0
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
                <p className="muted">No {name} part numbers in the BOM.</p>
            ) : (
                <>
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
        </fieldset>
    );
}

function JobStatus({
    job,
    progress,
    run,
    finished
}: {
    job: CollectJob;
    progress: Progress | undefined;
    run: CollectionRun | undefined;
    finished: boolean;
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
            {ended.state === "interrupted" && (
                <p className="warning">
                    Stopped: {ended.reason} Open Collect again to continue where
                    it stopped.
                </p>
            )}
        </section>
    );
}
