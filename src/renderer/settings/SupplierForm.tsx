import { useId, useState } from "react";
import type { ConnectionTest, SecretChanges } from "../../shared/ipc";
import type { SupplierId } from "../../shared/model";
import type { AppSettings } from "../../shared/settings";
import {
    SUPPLIER_SETTINGS,
    validateSupplierConfig,
    type ConfigField,
    type SupplierConfig
} from "../../shared/supplier-config";
import { SUPPLIERS } from "../../shared/suppliers";
import { errorMessage, isSettingsLocked } from "../errors";

const GROUPS = [
    { id: "credentials", title: "API credentials" },
    { id: "options", title: "Options" },
    { id: "limits", title: "Request limits" }
] as const;

interface SupplierFormProps {
    supplier: SupplierId;
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
    const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
    const [message, setMessage] = useState<{
        text: string;
        error: boolean;
    } | null>(null);

    const values = toConfig(fields, inputs);
    const errors = validateSupplierConfig(supplier, values);
    const secretChanges: SecretChanges = {};
    for (const [key, value] of Object.entries(secrets)) {
        if (value.trim() !== "") {
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
            setSecrets({});
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
                                Stored encrypted. Saved values are never shown;
                                type a new value to replace one.{" "}
                                <button
                                    type="button"
                                    className="link"
                                    onClick={() =>
                                        void window.api.app.openExternal(
                                            docsUrl
                                        )
                                    }
                                >
                                    Get {SUPPLIERS[supplier].name} API access
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
                    Save {SUPPLIERS[supplier].name} settings
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
    onRemove
}: {
    field: ConfigField;
    value: string;
    isSet: boolean;
    removed: boolean;
    onChange: (value: string) => void;
    onRemove: (remove: boolean) => void;
}) {
    const id = useId();
    return (
        <div className="form-row">
            <label htmlFor={id}>{field.label}</label>
            <div className="form-field">
                <div className="inline">
                    <input
                        id={id}
                        type="password"
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
