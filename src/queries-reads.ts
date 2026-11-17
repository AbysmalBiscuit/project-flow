import type {
	ProjectReport,
	RunAgent,
	RunArtifact,
	RunArtifactContent,
	RunCheckpoint,
	RunDetail,
	RunFile,
	RunSandbox,
	RunSettings,
	RunSource,
	Thread,
} from "./domain.ts";
import type { ArtifactsRead } from "./factory-run-artifacts.ts";
import type { CheckpointRead } from "./factory-run-detail.ts";
import type { FilesRead } from "./factory-run-files.ts";
import type { SandboxRead } from "./factory-run-sandbox.ts";
import type { RunSettingsRead } from "./factory-run-settings.ts";
import type { SourceRead } from "./factory-run-source.ts";
import { heldData } from "./queries-client.ts";
import { pendingStatus } from "./stale-reads.ts";

/** The app has not answered the read yet: it answered 202 and reads in the background. */
export class PendingRead extends Error {}

export async function readProject(
	name: string,
	view: "all",
): Promise<ProjectReport | null> {
	const response = await fetch(
		`/api/projects/${encodeURIComponent(name)}?view=${view}`,
	);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`project failed (HTTP ${response.status})`);
	}
	return (await response.json()) as ProjectReport;
}

export type ThreadRead =
	| { status: "ready"; thread: Thread }
	| { status: "pending" }
	| { status: "missing" }
	| { status: "failed" };

export async function readThread(
	tracker: string,
	project: string,
	key: string,
	host: string | undefined,
	queryKey: readonly unknown[],
): Promise<ThreadRead> {
	const onHost = host === undefined ? "" : `&host=${encodeURIComponent(host)}`;
	const path = `/api/threads/${tracker}/${encodeURIComponent(key)}?project=${encodeURIComponent(project)}${onHost}`;
	const response = await fetch(path);
	if (response.status === pendingStatus) {
		return heldData<ThreadRead>(queryKey) ?? { status: "pending" };
	}
	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			missing?: boolean;
		} | null;
		return body?.missing === true
			? { status: "missing" }
			: { status: "failed" };
	}
	return { status: "ready", thread: (await response.json()) as Thread };
}

export async function readAgents(
	runId: string,
	queryKey: readonly unknown[],
): Promise<RunAgent[]> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/agents`,
	);
	if (response.status === pendingStatus) {
		return heldData<RunAgent[]>(queryKey) ?? [];
	}
	if (response.status === 404) {
		return [];
	}
	if (!response.ok) {
		throw new Error(`agents failed (HTTP ${response.status})`);
	}
	return ((await response.json()) as { agents: RunAgent[] }).agents;
}

export async function readRun(id: string): Promise<RunDetail | null> {
	const response = await fetch(`/api/factory-runs/${encodeURIComponent(id)}`);
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`run failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunDetail;
}

export async function readCheckpoint(
	runId: string,
	queryKey: readonly unknown[],
): Promise<CheckpointRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/checkpoint`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<CheckpointRead>(queryKey);
		if (held === undefined) {
			throw new Error("checkpoint pending");
		}
		return held;
	}
	if (response.status === 404) {
		const body = (await response.json().catch(() => null)) as {
			notServed?: boolean;
		} | null;
		return body?.notServed === true ? "not served" : "missing";
	}
	if (!response.ok) {
		throw new Error(`checkpoint failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunCheckpoint;
}

export async function readArtifacts(
	runId: string,
	queryKey: readonly unknown[],
): Promise<ArtifactsRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/artifacts`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<ArtifactsRead>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		const body = (await response.json().catch(() => null)) as {
			notServed?: boolean;
		} | null;
		return body?.notServed === true ? "not served" : "missing";
	}
	if (!response.ok) {
		throw new Error(`artifacts failed (HTTP ${response.status})`);
	}
	return ((await response.json()) as { artifacts: RunArtifact[] }).artifacts;
}

export async function readSandbox(
	runId: string,
	queryKey: readonly unknown[],
): Promise<SandboxRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/sandbox`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<SandboxRead>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		const body = (await response.json().catch(() => null)) as {
			notServed?: boolean;
		} | null;
		return body?.notServed === true ? "not served" : "missing";
	}
	if (!response.ok) {
		throw new Error(`sandbox failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunSandbox;
}

export async function readFiles(
	runId: string,
	queryKey: readonly unknown[],
): Promise<FilesRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/files`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<FilesRead>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		const body = (await response.json().catch(() => null)) as {
			notServed?: boolean;
			gone?: boolean;
		} | null;
		return body?.notServed === true
			? "not served"
			: body?.gone === true
				? "gone"
				: "missing";
	}
	if (!response.ok) {
		throw new Error(`files failed (HTTP ${response.status})`);
	}
	return ((await response.json()) as { files: RunFile[] }).files;
}

export async function readSource(
	runId: string,
	queryKey: readonly unknown[],
): Promise<SourceRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/source`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<SourceRead>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		const body = (await response.json().catch(() => null)) as {
			notServed?: boolean;
		} | null;
		return body?.notServed === true ? "not served" : "missing";
	}
	if (!response.ok) {
		throw new Error(`source failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunSource;
}

export async function readRunSettings(
	runId: string,
	queryKey: readonly unknown[],
): Promise<RunSettingsRead> {
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/settings`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<RunSettingsRead>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		const body = (await response.json().catch(() => null)) as {
			notServed?: boolean;
		} | null;
		return body?.notServed === true ? "not served" : "missing";
	}
	if (!response.ok) {
		throw new Error(`run settings failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunSettings;
}

export async function readArtifact(
	runId: string,
	artifact: Pick<RunArtifact, "folder" | "name">,
	queryKey: readonly unknown[],
): Promise<RunArtifactContent | null> {
	const query = new URLSearchParams({
		folder: artifact.folder,
		name: artifact.name,
	}).toString();
	const response = await fetch(
		`/api/factory-runs/${encodeURIComponent(runId)}/artifact?${query}`,
	);
	if (response.status === pendingStatus) {
		const held = heldData<RunArtifactContent | null>(queryKey);
		if (held === undefined) {
			throw new PendingRead();
		}
		return held;
	}
	if (response.status === 404) {
		return null;
	}
	if (!response.ok) {
		throw new Error(`artifact failed (HTTP ${response.status})`);
	}
	return (await response.json()) as RunArtifactContent;
}
