import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunIo } from "../src/main.ts";

const emptyPage = {
	nodes: [],
	pageInfo: { hasNextPage: false, endCursor: null },
};

export function recordedDiscovery(
	input: string | URL | Request,
	init?: RequestInit,
): Response | null {
	const url = urlOf(input);
	const body = typeof init?.body === "string" ? init.body : "";
	if (url.startsWith("https://api.github.com/user/repos")) {
		return new Response("[]", {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}
	if (
		url === "https://api.github.com/graphql" &&
		(body.includes("ViewerProjects") || body.includes("OrgProjects"))
	) {
		return new Response(
			JSON.stringify({
				data: {
					viewer: {
						login: "lev",
						projectsV2: emptyPage,
						organizations: emptyPage,
					},
				},
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}
	if (url === "https://api.linear.app/graphql" && body.includes("projects(")) {
		return new Response(
			JSON.stringify({
				data: { viewer: { id: "lev" }, projects: emptyPage },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	}
	return null;
}

export function urlOf(input: string | URL | Request): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
}

export async function tempConfig(
	body: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "project-flow-"));
	const path = join(dir, "config.json");
	await writeFile(path, body);
	return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function testIo(io: RunIo): RunIo {
	return { listTodos: async () => "", ...io };
}
