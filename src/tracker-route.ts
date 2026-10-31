import type { Backends } from "./backends.ts";
import type { Configuration } from "./configuration.ts";
import { type Snapshot, trackerKinds } from "./domain.ts";
import { type Tracker, TrackerError } from "./ports.ts";
import { listedRef, type ProjectRef, refHost } from "./project-ref.ts";
import { namedSnapshot } from "./replies.ts";

/**
 * The tracker of the project that a route names, or null when none can reach it.
 * `declaredHost` is true for a project on a declared host. A `host` names the
 * host of a PR, and a project on another host has no tracker for that PR.
 */
export type TrackerOf = (
	name: string,
	project: string,
	host?: string,
) => { tracker: Tracker | null; declaredHost: boolean };

function namedRef(
	rows: Snapshot[],
	tracker: Snapshot["tracker"],
	project: string,
	hosts: Configuration["hosts"],
): ProjectRef {
	const row = namedSnapshot(rows, tracker, project);
	if (row !== undefined) {
		return listedRef(row);
	}
	const named = project.toLowerCase();
	const declared = hosts.find(({ host }) => named.startsWith(`${host}/`));
	return declared === undefined
		? listedRef({ key: project, tracker })
		: listedRef({
				key: project.slice(declared.host.length + 1),
				tracker,
				host: declared.host,
			});
}

/** A project on a host that no adapter reads has no tracker, so a write never reaches the home tracker of its kind. */
export function projectTrackers(
	backends: Pick<Backends, "readerOf">,
	rows: () => Snapshot[],
	hosts: () => Configuration["hosts"],
): TrackerOf {
	return (name, project, host) => {
		const kind = trackerKinds.find((known) => known === name);
		if (kind === undefined) {
			return { tracker: null, declaredHost: false };
		}
		const ref = namedRef(rows(), kind, project, hosts());
		const reader = backends.readerOf(ref, hosts());
		return {
			tracker:
				"tracker" in reader && (host === undefined || host === refHost(ref))
					? reader.tracker
					: null,
			declaredHost: refHost(ref) !== undefined,
		};
	};
}

/** Every route answers a failed tracker call with `{ error }` and the tracker's status. */
export function trackerError(error: unknown): Response {
	const message = error instanceof Error ? error.message : "tracker failed";
	const status = error instanceof TrackerError ? error.status : 502;
	return Response.json({ error: message }, { status });
}
