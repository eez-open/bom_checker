import { useId, useState, type ReactNode } from "react";
import { MIN_PASSWORD_LENGTH, newPasswordProblem } from "../../shared/password";
import { errorMessage } from "../errors";

function PasswordField({
    label,
    value,
    onChange,
    autoFocus
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    autoFocus?: boolean;
}) {
    const id = useId();
    return (
        <div className="form-row">
            <label htmlFor={id}>{label}</label>
            <input
                id={id}
                type="password"
                autoComplete="off"
                autoFocus={autoFocus}
                value={value}
                onChange={event => onChange(event.target.value)}
            />
        </div>
    );
}

function Form({
    onSubmit,
    children
}: {
    onSubmit: () => Promise<void>;
    children: ReactNode;
}) {
    return (
        <form
            className="settings-form"
            onSubmit={event => {
                event.preventDefault();
                void onSubmit();
            }}
        >
            {children}
        </form>
    );
}

/** First use: choose the password that protects the credentials. */
export function CreatePasswordForm({
    onCreated
}: {
    onCreated: (token: string) => void;
}) {
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [error, setError] = useState<string | null>(null);

    const submit = async () => {
        const problem = newPasswordProblem(password, confirmation);
        if (problem) {
            setError(problem);
            return;
        }
        try {
            onCreated(await window.api.vault.create(password));
        } catch (caught) {
            setError(errorMessage(caught));
        }
    };

    return (
        <Form onSubmit={submit}>
            <p>
                Supplier API credentials are stored encrypted with a password.
                Choose one now: you'll need it to change supplier settings, and
                once per session to collect supplier data. It can't be recovered
                if you forget it.
            </p>
            <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                autoFocus
            />
            <PasswordField
                label="Repeat password"
                value={confirmation}
                onChange={setConfirmation}
            />
            <p className="muted">At least {MIN_PASSWORD_LENGTH} characters.</p>
            {error && <p className="field-error">{error}</p>}
            <div className="form-actions">
                <button type="submit" className="primary">
                    Set password
                </button>
            </div>
        </Form>
    );
}

/** Asked every time supplier settings are opened. */
export function EnterPasswordForm({
    onOpened,
    onReset
}: {
    onOpened: (token: string) => void;
    onReset: () => void;
}) {
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);

    const submit = async () => {
        setChecking(true);
        try {
            const token = await window.api.vault.openSettings(password);
            if (token) {
                onOpened(token);
                return;
            }
            setError("Wrong password.");
        } catch (caught) {
            setError(errorMessage(caught));
        }
        setChecking(false);
    };

    const reset = async () => {
        try {
            if (await window.api.vault.reset()) {
                onReset();
            }
        } catch (caught) {
            setError(errorMessage(caught));
        }
    };

    return (
        <Form onSubmit={submit}>
            <p>Enter the password to change supplier settings.</p>
            <PasswordField
                label="Password"
                value={password}
                onChange={setPassword}
                autoFocus
            />
            {error && <p className="field-error">{error}</p>}
            <div className="form-actions">
                <button
                    type="button"
                    className="link"
                    onClick={() => void reset()}
                >
                    Forgot the password?
                </button>
                <button
                    type="submit"
                    className="primary"
                    disabled={checking || password === ""}
                >
                    {checking ? "Checking…" : "Unlock"}
                </button>
            </div>
        </Form>
    );
}

/** In Settings → General: the current password is the proof needed. */
export function ChangePasswordForm() {
    const [current, setCurrent] = useState("");
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [message, setMessage] = useState<{
        text: string;
        error: boolean;
    } | null>(null);

    const submit = async () => {
        const problem = newPasswordProblem(password, confirmation);
        if (problem) {
            setMessage({ text: problem, error: true });
            return;
        }
        try {
            const changed = await window.api.vault.changePassword(
                current,
                password
            );
            if (!changed) {
                setMessage({
                    text: "The current password is wrong.",
                    error: true
                });
                return;
            }
            setCurrent("");
            setPassword("");
            setConfirmation("");
            setMessage({ text: "Password changed.", error: false });
        } catch (caught) {
            setMessage({ text: errorMessage(caught), error: true });
        }
    };

    return (
        <Form onSubmit={submit}>
            <h3 className="section-gap">Change password</h3>
            <p className="muted">
                The password that protects the stored API credentials.
            </p>
            <PasswordField
                label="Current password"
                value={current}
                onChange={setCurrent}
            />
            <PasswordField
                label="New password"
                value={password}
                onChange={setPassword}
            />
            <PasswordField
                label="Repeat new password"
                value={confirmation}
                onChange={setConfirmation}
            />
            {message && (
                <p className={message.error ? "field-error" : "success"}>
                    {message.text}
                </p>
            )}
            <div className="form-actions">
                <button
                    type="submit"
                    className="primary"
                    disabled={!current || !password || !confirmation}
                >
                    Change password
                </button>
            </div>
        </Form>
    );
}
