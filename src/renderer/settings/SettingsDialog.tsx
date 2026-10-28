import { useEffect, useRef, useState } from "react";
import type { SecretStatus, VaultState } from "../../shared/ipc";
import type { SupplierId } from "../../shared/model";
import {
    DECIMAL_SEPARATORS,
    numberLocale,
    numbersFor,
    type DecimalSeparator
} from "../../shared/numbers";
import type { AppSettings } from "../../shared/settings";
import { ALL_SUPPLIERS, SUPPLIERS } from "../../shared/suppliers";
import { Modal } from "../dialogs/Modal";
import { errorMessage, isSettingsLocked } from "../errors";
import { setAppSettings, useAppSettings } from "../store/settings";
import {
    ChangePasswordForm,
    CreatePasswordForm,
    EnterPasswordForm
} from "./PasswordForms";
import { SupplierForm } from "./SupplierForm";

type Tab = "general" | "suppliers";

const SEPARATOR_LABELS: Record<DecimalSeparator, string> = {
    system: "As in the system's regional settings",
    point: "Decimal point",
    comma: "Decimal comma"
};

export function SettingsDialog({ onClose }: { onClose: () => void }) {
    const [tab, setTab] = useState<Tab>("general");
    const [settings, setLocalSettings] = useState<AppSettings | null>(null);
    // The rest of the app uses the saved settings too (e.g. best price).
    const setSettings = (saved: AppSettings) => {
        setLocalSettings(saved);
        setAppSettings(saved);
    };
    const [error, setError] = useState<string | null>(null);
    // Supplier settings session; asked for again each time the dialog opens.
    const [token, setToken] = useState<string | null>(null);
    const tokenRef = useRef<string | null>(null);

    useEffect(() => {
        window.api.settings
            .get()
            .then(setLocalSettings)
            .catch((caught: unknown) => setError(errorMessage(caught)));
    }, []);

    useEffect(() => {
        tokenRef.current = token;
    }, [token]);

    useEffect(
        () => () => {
            if (tokenRef.current) {
                window.api.vault.closeSettings(tokenRef.current);
            }
        },
        []
    );

    return (
        <Modal
            title="Settings"
            name="settings"
            size="large"
            onClose={onClose}
            footer={
                <button type="button" onClick={onClose}>
                    Close
                </button>
            }
        >
            <div className="tabs" role="tablist">
                {(["general", "suppliers"] as const).map(id => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => setTab(id)}
                    >
                        {id === "general" ? "General" : "Suppliers"}
                    </button>
                ))}
            </div>
            {error && <p className="field-error">{error}</p>}
            {settings && tab === "general" && (
                <GeneralPanel settings={settings} onChange={setSettings} />
            )}
            {settings &&
                tab === "suppliers" &&
                (token ? (
                    <SuppliersPanel
                        token={token}
                        settings={settings}
                        onChange={setSettings}
                        onLocked={() => setToken(null)}
                    />
                ) : (
                    <PasswordGate onOpened={setToken} />
                ))}
        </Modal>
    );
}

function GeneralPanel({
    settings,
    onChange
}: {
    settings: AppSettings;
    onChange: (settings: AppSettings) => void;
}) {
    const order = settings.general.supplierOrder;
    const systemLocale = useAppSettings(state => state.systemLocale);
    const [error, setError] = useState<string | null>(null);

    const save = async (general: AppSettings["general"]) => {
        try {
            onChange(await window.api.settings.saveGeneral(general));
        } catch (caught) {
            setError(errorMessage(caught));
        }
    };

    const move = (index: number, offset: number) => {
        const next = [...order];
        const [item] = next.splice(index, 1);
        next.splice(index + offset, 0, item!);
        return save({ ...settings.general, supplierOrder: next });
    };

    return (
        <section className="settings-form">
            <h3>Preferred suppliers</h3>
            <p className="muted">
                When two suppliers offer the same best price, the one higher in
                this list is chosen.
            </p>
            <ol className="supplier-order">
                {order.map((id, index) => (
                    <li key={id}>
                        <span>{SUPPLIERS[id].name}</span>
                        <button
                            type="button"
                            aria-label={`Move ${SUPPLIERS[id].name} up`}
                            disabled={index === 0}
                            onClick={() => void move(index, -1)}
                        >
                            ↑
                        </button>
                        <button
                            type="button"
                            aria-label={`Move ${SUPPLIERS[id].name} down`}
                            disabled={index === order.length - 1}
                            onClick={() => void move(index, 1)}
                        >
                            ↓
                        </button>
                    </li>
                ))}
            </ol>
            <h3 className="section-gap">Numbers</h3>
            <div role="radiogroup" aria-label="Decimal separator">
                {DECIMAL_SEPARATORS.map(separator => (
                    <label key={separator} className="checkbox">
                        <input
                            type="radio"
                            name="decimal-separator"
                            checked={
                                settings.general.decimalSeparator === separator
                            }
                            onChange={() =>
                                void save({
                                    ...settings.general,
                                    decimalSeparator: separator
                                })
                            }
                        />
                        {SEPARATOR_LABELS[separator]} (
                        {numbersFor(
                            numberLocale(separator, systemLocale)
                        ).quantity(1234.56)}
                        )
                    </label>
                ))}
            </div>
            <p className="muted">
                For the table, the dialogs and exports. CSV files with a decimal
                comma have &quot;;&quot; between the values.
            </p>
            <h3 className="section-gap">Troubleshooting</h3>
            <label className="checkbox">
                <input
                    type="checkbox"
                    checked={settings.general.logApiResponses}
                    onChange={event =>
                        void save({
                            ...settings.general,
                            logApiResponses: event.target.checked
                        })
                    }
                />
                Write supplier API responses to the log file
            </label>
            <p className="muted">
                Helps to find out why a supplier's data looks wrong. Responses
                can include your account's prices; API keys are left out. Help →
                About shows where the log file is.
            </p>
            {error && <p className="field-error">{error}</p>}
            <PasswordSection />
        </section>
    );
}

/** Change password, once there is one (#22). */
function PasswordSection() {
    const [hasPassword, setHasPassword] = useState(false);
    useEffect(() => {
        window.api.vault
            .getState()
            .then(state => setHasPassword(state !== "none"))
            .catch(() => setHasPassword(false));
    }, []);
    return hasPassword ? <ChangePasswordForm /> : null;
}

function PasswordGate({ onOpened }: { onOpened: (token: string) => void }) {
    const [state, setState] = useState<VaultState | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        window.api.vault
            .getState()
            .then(setState)
            .catch((caught: unknown) => setError(errorMessage(caught)));
    }, []);

    if (error) {
        return <p className="field-error">{error}</p>;
    }
    if (!state) {
        return null;
    }
    return state === "none" ? (
        <CreatePasswordForm onCreated={onOpened} />
    ) : (
        <EnterPasswordForm
            onOpened={onOpened}
            onReset={() => setState("none")}
        />
    );
}

type Section = SupplierId;

function SuppliersPanel({
    token,
    settings,
    onChange,
    onLocked
}: {
    token: string;
    settings: AppSettings;
    onChange: (settings: AppSettings) => void;
    onLocked: () => void;
}) {
    const [section, setSection] = useState<Section>("digikey");
    const [status, setStatus] = useState<SecretStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadStatus = () =>
        window.api.vault
            .getSecretStatus(token)
            .then(setStatus)
            .catch((caught: unknown) => {
                if (isSettingsLocked(caught)) {
                    onLocked();
                } else {
                    setError(errorMessage(caught));
                }
            });

    useEffect(() => {
        // Loaded once per session; refreshed after each save.
        window.api.vault
            .getSecretStatus(token)
            .then(setStatus)
            .catch((caught: unknown) => setError(errorMessage(caught)));
    }, [token]);

    const sections: { id: Section; label: string }[] = ALL_SUPPLIERS.map(
        supplier => ({ id: supplier.id, label: supplier.name })
    );

    return (
        <div className="settings-split">
            <nav aria-label="Supplier settings">
                {sections.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        aria-current={section === item.id}
                        onClick={() => setSection(item.id)}
                    >
                        {item.label}
                    </button>
                ))}
            </nav>
            <div>
                {error && <p className="field-error">{error}</p>}
                {status && (
                    <SupplierForm
                        key={section}
                        supplier={section}
                        token={token}
                        config={settings.suppliers[section]}
                        secretsSet={status[section]}
                        onLocked={onLocked}
                        onSaved={async saved => {
                            onChange(saved);
                            await loadStatus();
                        }}
                    />
                )}
            </div>
        </div>
    );
}
