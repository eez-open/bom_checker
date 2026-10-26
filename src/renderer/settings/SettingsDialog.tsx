import { useEffect, useRef, useState } from "react";
import type { SecretStatus, VaultState } from "../../shared/ipc";
import type { SupplierId } from "../../shared/model";
import type { AppSettings } from "../../shared/settings";
import { ALL_SUPPLIERS, SUPPLIERS } from "../../shared/suppliers";
import { Modal } from "../dialogs/Modal";
import { errorMessage, isSettingsLocked } from "../errors";
import {
    ChangePasswordForm,
    CreatePasswordForm,
    EnterPasswordForm
} from "./PasswordForms";
import { SupplierForm } from "./SupplierForm";

type Tab = "general" | "suppliers";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
    const [tab, setTab] = useState<Tab>("general");
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Supplier settings session; asked for again each time the dialog opens.
    const [token, setToken] = useState<string | null>(null);
    const tokenRef = useRef<string | null>(null);

    useEffect(() => {
        window.api.settings
            .get()
            .then(setSettings)
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
    const [error, setError] = useState<string | null>(null);

    const move = async (index: number, offset: number) => {
        const next = [...order];
        const [item] = next.splice(index, 1);
        next.splice(index + offset, 0, item!);
        try {
            onChange(
                await window.api.settings.saveGeneral({ supplierOrder: next })
            );
        } catch (caught) {
            setError(errorMessage(caught));
        }
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
            {error && <p className="field-error">{error}</p>}
        </section>
    );
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

type Section = SupplierId | "password";

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

    const sections: { id: Section; label: string }[] = [
        ...ALL_SUPPLIERS.map(supplier => ({
            id: supplier.id,
            label: supplier.name
        })),
        { id: "password", label: "Password" }
    ];

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
                {section === "password" ? (
                    <ChangePasswordForm token={token} onLocked={onLocked} />
                ) : (
                    status && (
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
                    )
                )}
            </div>
        </div>
    );
}
