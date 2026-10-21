import { type RunIo, run, waitForStop } from "../src/main.ts";

/** A proof server exits after this long when nobody stops it. */
export const proofServerLifetimeMs = 30 * 60 * 1000;

const parentPollMs = 1_000;

function lifetimeMs(): number {
	const override = process.env.PROJECT_FLOW_PROOF_LIFETIME_MS;
	if (override === undefined || override.trim() === "") {
		return proofServerLifetimeMs;
	}
	if (override !== override.trim()) {
		throw new Error(
			"PROJECT_FLOW_PROOF_LIFETIME_MS needs a non-negative number of milliseconds",
		);
	}
	const parsed = Number(override);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(
			"PROJECT_FLOW_PROOF_LIFETIME_MS needs a non-negative number of milliseconds",
		);
	}
	return parsed;
}

function parentStillRuns(): boolean {
	try {
		process.kill(process.ppid, 0);
		return true;
	} catch {
		return false;
	}
}

let stops: Promise<void> | undefined;

export function proofStops(): Promise<void> {
	stops ??= watchProof();
	return stops;
}

function watchProof(): Promise<void> {
	const lifetime = lifetimeMs();
	const stopsHere = new Promise<void>((resolve) => {
		const stop = () => resolve();
		void waitForStop().then(stop);
		const timer = setTimeout(stop, lifetime);
		timer.unref?.();
		const watch = setInterval(() => {
			if (parentStillRuns()) {
				return;
			}
			clearInterval(watch);
			clearTimeout(timer);
			stop();
		}, parentPollMs);
		watch.unref?.();
	});
	void stopsHere.then(() => {
		process.exit(0);
	});
	return stopsHere;
}

export async function serveProof(args: string[], io: RunIo): Promise<never> {
	const result = await run(args, { ...io, waitForStop: proofStops() });
	process.exit(result.exitCode);
}
