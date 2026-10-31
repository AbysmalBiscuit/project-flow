/** The error of a declared host whose token env var is empty. */
export function missingHostToken(tokenEnv: string, host: string): string {
	return `${tokenEnv} is missing: set ${tokenEnv} to read ${host}.`;
}

/** The error of a declared host that refused the token of its env var. */
export function rejectedHostToken(tokenEnv: string, host: string): string {
	return `${tokenEnv} was rejected by ${host} (HTTP 401): set a valid token.`;
}
