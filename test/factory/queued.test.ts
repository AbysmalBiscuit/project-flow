import { describe, expect, test } from "bun:test";

import { daemon, factoryFetch, hubUrl, serve } from "../support/factory.ts";
import { repo } from "../support/github.ts";
import { linearFake } from "../support/linear.ts";
import { readyLabel, serveGithub, ticketWhere } from "./_support.ts";

function serveLinear(state: { id: string; name: string; type: string }) {
	const tracker = linearFake({
		project: {
			id: "11111111-1111-4111-8111-111111111111",
			name: "Widget launch",
			slugId: "widget-launch",
		},
		issues: [
			{
				id: "issue-pf-1",
				identifier: "PF-1",
				title: "Ready ticket",
				description: "Body",
				state: { ...state, color: "#bec2c8" },
				updatedAt: "2026-08-18T12:00:00.000Z",
				labels: { nodes: [] },
				comments: { nodes: [] },
				team: { id: "team-pf" },
			},
		],
	});
	return serve(
		[],
		{
			pinned: [{ tracker: "linear", project: "widget-launch" }],
			factories: [{ name: "work hub", url: hubUrl, readyStatus: "Todo" }],
		},
		factoryFetch({ [hubUrl]: daemon }, [], tracker),
		{ env: { LINEAR_API_KEY: "recorded-linear-key" } },
	);
}

describe("queued tickets", () => {
	test("an open GitHub ticket with the ready label and no run is queued on the factory", async () => {
		const app = await serveGithub([43], {
			readyLabel,
			labels: { 43: [readyLabel] },
		});
		try {
			const view = await ticketWhere(
				app.base,
				repo,
				`${repo}#43`,
				(item) => item.title !== "",
			);
			expect(view.queued).toEqual({ factory: "work hub", label: readyLabel });
		} finally {
			await app.stop();
		}
	});

	test("a Linear ticket in the ready status of the factory is queued, and one in another status is not", async () => {
		const ready = await serveLinear({
			id: "state-todo",
			name: "Todo",
			type: "unstarted",
		});
		try {
			const view = await ticketWhere(
				ready.base,
				"Widget launch",
				"PF-1",
				(item) => item.title !== "",
			);
			expect(view.queued).toEqual({ factory: "work hub", status: "Todo" });
		} finally {
			await ready.stop();
		}
		const backlog = await serveLinear({
			id: "state-backlog",
			name: "Backlog",
			type: "backlog",
		});
		try {
			const view = await ticketWhere(
				backlog.base,
				"Widget launch",
				"PF-1",
				(item) => item.title !== "",
			);
			expect(view.queued).toBeUndefined();
		} finally {
			await backlog.stop();
		}
	});

	test("a ready-labelled ticket with a live or succeeded run, or a closed one, is not queued", async () => {
		const app = await serveGithub([40, 41, 44], {
			readyLabel,
			closed: [44],
			labels: { 40: [readyLabel], 41: [readyLabel], 44: [readyLabel] },
		});
		try {
			for (const number of [40, 41]) {
				const view = await ticketWhere(
					app.base,
					repo,
					`${repo}#${number}`,
					(item) => item.factoryRun !== undefined,
				);
				expect(view.queued).toBeUndefined();
			}
			const closed = await ticketWhere(
				app.base,
				repo,
				`${repo}#44`,
				(item) => item.title !== "",
			);
			expect(closed.queued).toBeUndefined();
		} finally {
			await app.stop();
		}
	});

	test("a labelled ticket of a factory with no ready label or status is not queued", async () => {
		const app = await serveGithub([43], { labels: { 43: [readyLabel] } });
		try {
			const view = await ticketWhere(
				app.base,
				repo,
				`${repo}#43`,
				(item) => item.title !== "",
			);
			expect(view.queued).toBeUndefined();
		} finally {
			await app.stop();
		}
	});
});
