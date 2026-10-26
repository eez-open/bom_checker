/** An error's message without Electron's "Error invoking remote method"
 *  prefix, for showing to the user. */
export function errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(
        /^Error invoking remote method '[^']+': (\w*Error: )?/,
        ""
    );
}

/** True when main rejected a change because supplier settings were locked
 *  (session expired, or "Lock Credentials" was used). */
export function isSettingsLocked(error: unknown): boolean {
    return (
        error instanceof Error && error.message.includes("SettingsLockedError")
    );
}
