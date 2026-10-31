import { describe, expect, test } from "bun:test";

import type { Configuration } from "../../src/configuration.ts";
import type { Snapshot } from "../../src/domain.ts";
import type { Fetch } from "../../src/fetch.ts";
import { settledSettings } from "../support/reads.ts";
import { defaultStates } from "../support/states.ts";
import {
	host,
	hostedWidget,
	hosts,
	openTicket,
	recordedFetch,
	widget,
	widgetRow,
	withStoredRows,
} from "./_support.ts";

const hostedKey = `${host}/acme/widget`;

describe("a repo tracked on github.com and on a declared host", () => {
	const board: NonNullable<Snapshot["board"]> = {
		kind: "github-repo",
		factoryLabels: false,
		statuses: [
			{ id: "qa", name: "qa", statusType: "inProgress", colour: "#aa00cc" },
		],
	};
	const ready = {
		id: "ready",
		label: "Ready",
		colour: "#123456",
		categories: [],
	};
	const checking = {
		id: "checking",
		label: "Checking",
		colour: "#654321",
		categories: [],
	};
	const stateMappings: Configuration["stateMappings"] = {
		"acme/widget": { qa: "ready" },
		[hostedKey]: { qa: "checking" },
	};
	const rows = [
		widgetRow({ tickets: [openTicket(5, ["qa"])], board }),
		widgetRow({
			name: hostedKey,
			host,
			tickets: [openTicket(5, ["qa"])],
			board,
		}),
	];
	const unreadHome: Fetch = (input, init) => {
		const body = typeof init?.body === "string" ? init.body : "";
		return body.includes("query RepoRead")
			? Promise.resolve(new Response("recorded outage", { status: 500 }))
			: recordedFetch(200)(input, init);
	};

	async function laneOf(base: string, project: string): Promise<string> {
		const response = await fetch(
			new URL(`/api/projects/${encodeURIComponent(project)}`, base),
		);
		expect(response.status).toBe(200);
		const report = (await response.json()) as {
			sections: { items?: { key: string | null; lane?: string }[] }[];
		};
		const item = report.sections
			.flatMap((section) => section.items ?? [])
			.find((entry) => entry.key === "acme/widget#5");
		return item?.lane ?? "";
	}

	test("Settings lists a state source for each host, and each row applies its own mapping", async () => {
		await withStoredRows(
			rows,
			{
				hosts,
				tracked: [widget, hostedWidget],
				states: [...defaultStates, ready, checking],
				stateMappings,
			},
			async (base) => {
				const settings = await settledSettings<{
					stateSources: { key: string; projects: string[] }[];
				}>(base);
				expect(
					settings.stateSources.map(({ key, projects }) => ({
						key,
						projects,
					})),
				).toEqual([
					{ key: "acme/widget", projects: ["acme/widget"] },
					{ key: hostedKey, projects: [hostedKey] },
				]);
				expect(await laneOf(base, "acme/widget")).toBe("Ready");
				expect(await laneOf(base, hostedKey)).toBe("Checking");
			},
			unreadHome,
		);
	});
});
