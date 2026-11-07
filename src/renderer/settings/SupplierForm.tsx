import { useEffect, useId, useState } from "react";
import type { ConnectionTest, SecretChanges } from "../../shared/ipc";
import type { AppSettings } from "../../shared/settings";
import {
    SUPPLIER_SETTINGS,
    validateSupplierConfig,
    type AccountId,
    type ConfigField,
    type SupplierConfig
} from "../../shared/supplier-config";
import { ACCOUNT_NAMES } from "../../shared/suppliers";
import { errorMessage, isSettingsLocked } from "../errors";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from "../icons";

const GROUPS = [
    { id: "credentials", title: "API credentials" },
    { id: "options", title: "Options" },
    { id: "limits", title: "Request limits" }
] as const;

interface SupplierFormProps {
    /** Arrow's inventory sources share Arrow's settings (#62). */
    supplier: AccountId;
    token: string;
    config: SupplierConfig;
    /** Which secret fields have a stored value. */
    secretsSet: Record<string, boolean>;
    onSaved: (settings: AppSettings) => Promise<void>;
    onLocked: () => void;
}

/** Inputs hold text; numbers are converted when validating and saving. */
function toConfig(
    fields: readonly ConfigField[],
    inputs: Record<string, string>
): SupplierConfig {
    const config: SupplierConfig = {};
    for (const field of fields) {
        if (field.kind === "number") {
            const text = inputs[field.key]?.trim() ?? "";
            config[field.key] = text === "" ? Number.NaN : Number(text);
        } else if (field.kind !== "secret") {
            config[field.key] = inputs[field.key]?.trim() ?? "";
        }
    }
    return config;
}

export function SupplierForm({
    supplier,
    token,
    config,
    secretsSet,
    onSaved,
    onLocked
}: SupplierFormProps) {
    const { fields, docsUrl } = SUPPLIER_SETTINGS[supplier];
    const [inputs, setInputs] = useState<Record<string, string>>(() =>
        Object.fromEntries(
            Object.entries(config).map(([key, value]) => [key, String(value)])
        )
    );
    const [secrets, setSecrets] = useState<Record<string, string>>({});
    /** Saved values shown in the inputs; saved again only when edited. */
    const [loaded, setLoaded] = useState<Record<string, string>>({});
    const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
    const [message, setMessage] = useState<{
        text: string;
        error: boolean;
    } | null>(null);

    const values = toConfig(fields, inputs);
    const errors = validateSupplierConfig(supplier, values);
    const secretChanges: SecretChanges = {};
    for (const [key, value] of Object.entries(secrets)) {
        if (value.trim() !== "" && value !== loaded[key]) {
            secretChanges[key] = value;
        }
    }
    for (const key of removed) {
        secretChanges[key] = null;
    }
    const changed =
        Object.keys(secretChanges).length > 0 ||
        fields.some(field => values[field.key] !== config[field.key]);

    const save = async () => {
        try {
            const settings = await window.api.settings.saveSupplier(
                token,
                supplier,
                values,
                secretChanges
            );
            await onSaved(settings);
            // The inputs now hold the saved values.
            const kept = Object.fromEntries(
                Object.entries(secrets).filter(
                    ([key, value]) => value.trim() !== "" && !removed.has(key)
                )
            );
            setSecrets(kept);
            setLoaded(kept);
            setRemoved(new Set());
            setMessage({ text: "Saved.", error: false });
        } catch (error) {
            if (isSettingsLocked(error)) {
                onLocked();
            } else {
                setMessage({ text: errorMessage(error), error: true });
            }
        }
    };

    const readSaved = async (key: string): Promise<string | null> => {
        try {
            return await window.api.vault.getSecret(token, supplier, key);
        } catch (error) {
            if (isSettingsLocked(error)) {
                onLocked();
            } else {
                setMessage({ text: errorMessage(error), error: true });
            }
            return null;
        }
    };

    /** Puts the saved value in an empty input. */
    const reveal = async (key: string) => {
        if (secrets[key] || !secretsSet[key]) {
            return;
        }
        const value = await readSaved(key);
        if (value !== null) {
            setSecrets(current =>
                current[key] ? current : { ...current, [key]: value }
            );
            setLoaded(current => ({ ...current, [key]: value }));
        }
    };

    /** Copies what the input holds, or else the saved value. */
    const copy = async (key: string): Promise<boolean> => {
        const value = secrets[key] || (await readSaved(key));
        if (!value) {
            return false;
        }
        try {
            await window.api.app.copyText(value);
            return true;
        } catch (error) {
            setMessage({ text: errorMessage(error), error: true });
            return false;
        }
    };

    const [test, setTest] = useState<ConnectionTest | "running" | null>(null);
    const testConnection = async () => {
        setTest("running");
        try {
            setTest(await window.api.collect.testConnection(token, supplier));
        } catch (error) {
            if (isSettingsLocked(error)) {
                onLocked();
            } else {
                setTest({ ok: false, lines: [errorMessage(error)] });
            }
        }
    };

    const setInput = (key: string, value: string) => {
        setInputs(current => ({ ...current, [key]: value }));
        setMessage(null);
    };

    return (
        <form
            className="settings-form"
            onSubmit={event => {
                event.preventDefault();
                void save();
            }}
        >
            {GROUPS.map(group => {
                const groupFields = fields.filter(f => f.group === group.id);
                if (groupFields.length === 0) {
                    return null;
                }
                return (
                    <fieldset key={group.id}>
                        <legend>{group.title}</legend>
                        {group.id === "credentials" && (
                            <p className="muted">
                                Stored encrypted. Type a new value to replace a
                                saved one.{" "}
                                <button
                                    type="button"
                                    className="link"
                                    onClick={() =>
                                        void window.api.app.openExternal(
                                            docsUrl
                                        )
                                    }
                                >
                                    Get {ACCOUNT_NAMES[supplier]} API access
                                </button>
                            </p>
                        )}
                        {groupFields.map(field =>
                            field.kind === "secret" ? (
                                <SecretInput
                                    key={field.key}
                                    field={field}
                                    value={secrets[field.key] ?? ""}
                                    isSet={Boolean(secretsSet[field.key])}
                                    removed={removed.has(field.key)}
                                    onChange={value => {
                                        setSecrets(current => ({
                                            ...current,
                                            [field.key]: value
                                        }));
                                        setMessage(null);
                                    }}
                                    onReveal={() => reveal(field.key)}
                                    onCopy={() => copy(field.key)}
                                    onRemove={remove => {
                                        const next = new Set(removed);
                                        if (remove) {
                                            next.add(field.key);
                                        } else {
                                            next.delete(field.key);
                                        }
                                        setRemoved(next);
                                        setMessage(null);
                                    }}
                                />
                            ) : (
                                <ConfigInput
                                    key={field.key}
                                    field={field}
                                    value={inputs[field.key] ?? ""}
                                    error={errors[field.key]}
                                    onChange={value =>
                                        setInput(field.key, value)
                                    }
                                />
                            )
                        )}
                    </fieldset>
                );
            })}
            {message && (
                <p className={message.error ? "field-error" : "success"}>
                    {message.text}
                </p>
            )}
            <div className="form-actions">
                <button
                    type="button"
                    title={changed ? "Save the changes first" : undefined}
                    disabled={changed || test === "running"}
                    onClick={() => void testConnection()}
                >
                    {test === "running" ? "Testing…" : "Test connection"}
                </button>
                <button
                    type="submit"
                    className="primary"
                    disabled={!changed || Object.keys(errors).length > 0}
                >
                    Save {ACCOUNT_NAMES[supplier]} settings
                </button>
            </div>
            {test && test !== "running" && (
                <div
                    className={
                        test.ok ? "test-result" : "test-result field-error"
                    }
                    role="status"
                >
                    {test.lines.map((line, index) => (
                        <div key={index}>{line}</div>
                    ))}
                </div>
            )}
        </form>
    );
}

function SecretInput({
    field,
    value,
    isSet,
    removed,
    onChange,
    onReveal,
    onCopy,
    onRemove
}: {
    field: ConfigField;
    value: string;
    isSet: boolean;
    removed: boolean;
    onChange: (value: string) => void;
    onReveal: () => Promise<void>;
    onCopy: () => Promise<boolean>;
    onRemove: (remove: boolean) => void;
}) {
    const id = useId();
    const [shown, setShown] = useState(false);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) {
            return;
        }
        const timer = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(timer);
    }, [copied]);

    const show = async () => {
        if (!shown) {
            await onReveal();
        }
        setShown(!shown);
    };
    const copy = async () => setCopied(await onCopy());
    const showLabel = `${shown ? "Hide" : "Show"} ${field.label}`;
    const copyLabel = copied ? "Copied" : `Copy ${field.label}`;

    return (
        <div className="form-row">
            <label htmlFor={id}>{field.label}</label>
            <div className="form-field">
                <div className="inline">
                    <input
                        id={id}
                        type={shown ? "text" : "password"}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={removed}
                        placeholder={
                            removed
                                ? "Removed when you save"
                                : isSet
                                  ? "Saved"
                                  : "Not set"
                        }
                        value={value}
                        onChange={event => onChange(event.target.value)}
                    />
                    <button
                        type="button"
                        className="icon"
                        title={showLabel}
                        aria-label={showLabel}
                        disabled={removed}
                        onClick={() => void show()}
                    >
                        {shown ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                    <button
                        type="button"
                        className="icon"
                        title={copyLabel}
                        aria-label={copyLabel}
                        disabled={removed || (!isSet && value === "")}
                        onClick={() => void copy()}
                    >
                        {copied ? <CheckIcon /> : <CopyIcon />}
                    </button>
                    {isSet && (
                        <button
                            type="button"
                            onClick={() => onRemove(!removed)}
                        >
                            {removed ? "Keep" : "Remove"}
                        </button>
                    )}
                </div>
                {field.help && <div className="muted">{field.help}</div>}
            </div>
        </div>
    );
}

function ConfigInput({
    field,
    value,
    error,
    onChange
}: {
    field: ConfigField;
    value: string;
    error: string | undefined;
    onChange: (value: string) => void;
}) {
    const id = useId();
    if (field.kind === "multiselect") {
        // Checkboxes, saved as "A,B" in the options' order.
        const chosen = new Set(value.split(",").filter(Boolean));
        return (
            <div className="form-row">
                <span id={id}>{field.label}</span>
                <div className="form-field">
                    <div
                        className="checkbox-list"
                        role="group"
                        aria-labelledby={id}
                    >
                        {field.options.map(option => (
                            <label key={option.value} className="checkbox">
                                <input
                                    type="checkbox"
                                    checked={chosen.has(option.value)}
                                    onChange={event => {
                                        const next = new Set(chosen);
                                        if (event.target.checked) {
                                            next.add(option.value);
                                        } else {
                                            next.delete(option.value);
                                        }
                                        onChange(
                                            field.options
                                                .map(o => o.value)
                                                .filter(v => next.has(v))
                                                .join(",")
                                        );
                                    }}
                                />
                                {option.label}
                            </label>
                        ))}
                    </div>
                    {error && <div className="field-error">{error}</div>}
                    {field.help && <div className="muted">{field.help}</div>}
                </div>
            </div>
        );
    }
    return (
        <div className="form-row">
            <label htmlFor={id}>{field.label}</label>
            <div className="form-field">
                <div className="inline">
                    {field.kind === "select" ? (
                        <select
                            id={id}
                            value={value}
                            onChange={event => onChange(event.target.value)}
                        >
                            {field.options.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <input
                            id={id}
                            inputMode={
                                field.kind === "number" ? "numeric" : undefined
                            }
                            className={
                                field.kind === "number" ? "number" : undefined
                            }
                            value={value}
                            aria-invalid={error !== undefined}
                            onChange={event => onChange(event.target.value)}
                        />
                    )}
                    {field.kind === "number" && field.unit && (
                        <span className="muted">{field.unit}</span>
                    )}
                </div>
                {error && <div className="field-error">{error}</div>}
                {field.help && <div className="muted">{field.help}</div>}
            </div>
        </div>
    );
}
