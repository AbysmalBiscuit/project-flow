import { z } from "zod";

import type { RunArtifact, RunArtifactContent } from "./domain.ts";
import { body, NotServed, reader, Unreachable } from "./factory-http.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";

export type ArtifactsRead = RunArtifact[] | "missing" | "not served";

/** One item of `GET /runs/{id}/artifacts`. */
const artifact = z.object({
	stage: z.string(),
	node_path: z.string(),
	name: z.string(),
	type: z.string(),
	size: z.number(),
});

const artifactList = z.object({ artifacts: z.array(artifact) });

const artifactContent = artifact.extend({
	encoding: z.enum(["utf-8", "base64"]),
	content: z.string(),
});

function shown(item: z.infer<typeof artifact>): RunArtifact {
	return {
		folder: item.stage,
		stage: item.node_path,
		name: item.name,
		type: item.type,
		size: item.size,
	};
}

/** A stage folder and a name can hold `/`, which the factory route keeps as a path separator. */
function pathOf(value: string): string {
	return value.split("/").map(encodeURIComponent).join("/");
}

/**
 * The artifacts of a run, and the content of one of them, from the hub that
 * reports the run, or else from its box. The hub relays both reads to the box.
 */
export function runArtifactsReader(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
}) {
	const { fetchImpl, signal, statusRowOf } = deps;
	const readOf = (runId: string) => {
		const { hubRow, row } = statusRowOf(runId);
		const target = hubRow ?? row;
		return target === undefined ? null : reader(fetchImpl, target.url, signal);
	};
	const artifacts = async (runId: string): Promise<ArtifactsRead> => {
		const read = readOf(runId);
		if (read === null) {
			return "missing";
		}
		try {
			const listed = await body(
				await read(`/runs/${encodeURIComponent(runId)}/artifacts`),
				artifactList,
			);
			return listed.artifacts.map(shown);
		} catch (error) {
			if (error instanceof NotServed) {
				return "not served";
			}
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return "missing";
		}
	};
	/** Null when no factory reports the run, or the factory holds no such artifact. */
	const artifactOf = async (
		runId: string,
		folder: string,
		name: string,
	): Promise<RunArtifactContent | null> => {
		const read = readOf(runId);
		if (read === null) {
			return null;
		}
		try {
			const found = await body(
				await read(
					`/runs/${encodeURIComponent(runId)}/artifacts/${pathOf(folder)}/${pathOf(name)}`,
				),
				artifactContent,
			);
			return {
				...shown(found),
				encoding: found.encoding,
				content: found.content,
			};
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return null;
		}
	};
	return { artifacts, artifact: artifactOf };
}
