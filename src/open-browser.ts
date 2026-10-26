import { existsSync } from "node:fs";

function wslInterop(): boolean {
	return existsSync("/proc/sys/fs/binfmt_misc/WSLInterop");
}

function whichOn(
	name: string,
	env: Record<string, string | undefined>,
): string | null {
	return Bun.which(name, { PATH: env.PATH ?? "" });
}

function windowsBrowser(
	url: string,
	env: Record<string, string | undefined>,
): string[] | null {
	const powershell = whichOn("powershell.exe", env);
	if (powershell === null) {
		return null;
	}
	const quoted = `'${url.replaceAll("'", "''")}'`;
	return [powershell, "-NoProfile", "-Command", `Start-Process ${quoted}`];
}

function browserLaunch(
	url: string,
	env: Record<string, string | undefined>,
): string[] | null {
	if (process.platform === "darwin") {
		const open = whichOn("open", env);
		return open === null ? null : [open, url];
	}
	if (wslInterop()) {
		const windows = windowsBrowser(url, env);
		if (windows !== null) {
			return windows;
		}
		const wslview = whichOn("wslview", env);
		if (wslview !== null) {
			return [wslview, url];
		}
		return null;
	}
	const xdgOpen = whichOn("xdg-open", env);
	if (xdgOpen === null) {
		return null;
	}
	return [xdgOpen, url];
}

export async function openBrowser(
	url: string,
	env: Record<string, string | undefined>,
): Promise<void> {
	const launch = browserLaunch(url, env);
	if (launch === null) {
		throw new Error("no browser opener");
	}
	const proc = Bun.spawn(launch, {
		stdout: "ignore",
		stderr: "ignore",
		env,
	});
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`browser opener exited ${code}`);
	}
}
