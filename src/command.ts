/** The trimmed stdout of a command that exits 0, or null when it fails or is not installed. */
export async function command(
	args: string[],
	env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
	try {
		const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env });
		const [out, code] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		return code === 0 ? out.trim() : null;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}
