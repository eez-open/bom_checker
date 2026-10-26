export const MIN_PASSWORD_LENGTH = 8;

/** Why a new password can't be used, or null if it can. */
export function newPasswordProblem(
    password: string,
    confirmation: string
): string | null {
    if (password.length < MIN_PASSWORD_LENGTH) {
        return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    return password === confirmation ? null : "The passwords don't match.";
}
