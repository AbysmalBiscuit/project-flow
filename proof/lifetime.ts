import { type RunIo, run, waitForStop } from "../src/main.ts";

/** A proof server exits after this long when nobody stops it. */
export const proofServerLifetimeMs = 30 * 60 * 1000;

const parentPollMs = 1_000;

/** Caller cleanup after a stop; a stall still ends the process. */
const shutdownGraceMs = 5_000;

function lifetimeMs(): number {
	const override = process.env.PROJECT_FLOW_PROOF_LIFETIME_MS;
	if (override === undefined || override.trim() === "") {
		return proofServerLifetimeMs;
	}
	if (!/^\d+(\.\d+)?$/.test(override.trim())) {
		throw new Error(
			"PROJECT_FLOW_PROOF_LIFETIME_MS needs a non-negative number of milliseconds",
		);
	}
	return Number(override);
}

function parentStillRuns(parent: number): boolean {
	return process.ppid === parent;
}

let stops: Promise<void> | undefined;

export function proofStops(): Promise<void> {
	stops ??= watchProof();
	return stops;
}

function watchProof(): Promise<void> {
	const lifetime = lifetimeMs();
	const parent = process.ppid;
	const stopsHere = new Promise<void>((resolve) => {
		const stop = () => {
			clearInterval(watch);
			clearTimeout(timer);
			resolve();
		};
		void waitForStop().then(stop);
		const timer = setTimeout(stop, lifetime);
		timer.unref();
		const watch = setInterval(() => {
			if (parentStillRuns(parent)) {
				return;
			}
			stop();
		}, parentPollMs);
		watch.unref();
	});
	void stopsHere.then(() => {
		const force = setTimeout(() => {
			process.exit(1);
		}, shutdownGraceMs);
		force.unref();
	});
	return stopsHere;
}

export async function serveProof(args: string[], io: RunIo): Promise<never> {
	const result = await run(args, { ...io, waitForStop: proofStops() });
	process.exit(result.exitCode);
}
