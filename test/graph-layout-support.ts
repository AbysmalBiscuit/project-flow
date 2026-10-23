import type { ProjectReport } from "../src/domain.ts";
import { projectNodeId } from "../src/graph-flow.ts";
import {
	frameId,
	type GraphLayout,
	type LayoutInput,
	type Rect,
} from "../src/graph-layout.ts";
import { linearSlug, withApp } from "./project-harness.ts";
import { type LinearFake, linearFake } from "./support.ts";

export const card = { width: 220, height: 96 };
export const workcell = (await Bun.file(
	new URL("./fixtures/workcell-graph-report.json", import.meta.url),
).json()) as ProjectReport;

export const linearTicket = (
	id: string,
	title: string,
	state: "unstarted" | "completed",
	parent: string | null,
	blocks: string[] = [],
	milestone = "Beta",
) => ({
	id,
	identifier: id,
	title,
	description: "",
	state: { type: state },
	updatedAt: "2026-10-21T12:00:00.000Z",
	projectMilestone: { name: milestone },
	labels: { nodes: [] },
	parent: parent === null ? null : { identifier: parent },
	inverseRelations: {
		nodes: blocks.map((blocker) => ({
			type: "blocks",
			issue: {
				identifier: blocker,
				title: blocker,
				state: { type: "unstarted" },
				project: { slugId: linearSlug },
			},
		})),
	},
});

// Four ticket levels under WID-1, two sibling parent tickets at each of the
// two upper levels, and blocker arrows that cross frame borders.
export const hierarchy = [
	linearTicket("WID-1", "Ship the widget", "unstarted", null),
	linearTicket("WID-2", "Paint the list", "unstarted", "WID-1"),
	linearTicket("WID-3", "Paint the rows", "unstarted", "WID-2"),
	linearTicket("WID-4", "Paint the cells", "unstarted", "WID-3"),
	linearTicket("WID-5", "Paint the borders", "unstarted", "WID-3", ["WID-8"]),
	linearTicket("WID-6", "Size the cells", "unstarted", "WID-2"),
	linearTicket("WID-7", "Sort the list", "unstarted", "WID-1"),
	linearTicket("WID-8", "Sort by name", "unstarted", "WID-7"),
	linearTicket("WID-9", "Sort by date", "unstarted", "WID-7", ["WID-6"]),
	linearTicket("WID-10", "Move the archive", "unstarted", null),
	linearTicket("WID-11", "Copy the archive", "unstarted", "WID-10", ["WID-4"]),
	linearTicket("WID-12", "Check the copies", "unstarted", "WID-10"),
	linearTicket("WID-20", "Write the runbook", "unstarted", null),
];

// WID-1 and WID-2 sit in Beta, while the WID-3 chain below WID-1 sits in Gamma.
export const milestones = [
	linearTicket("WID-1", "Ship the widget", "unstarted", null),
	linearTicket("WID-2", "Paint the list", "unstarted", "WID-1"),
	linearTicket("WID-3", "Sort the list", "unstarted", "WID-1", [], "Gamma"),
	linearTicket("WID-4", "Sort by name", "unstarted", "WID-3", [], "Gamma"),
];

export async function hierarchyReport(
	search: string,
	issues: LinearFake["issues"] = hierarchy,
): Promise<ProjectReport> {
	let report: ProjectReport | null = null;
	await withApp(
		JSON.stringify({
			pinned: [{ tracker: "linear", project: linearSlug }],
			projectViews: { "Widget launch": { search } },
		}),
		linearFake({
			project: {
				id: "project-widget",
				name: "Widget launch",
				slugId: linearSlug,
			},
			issues,
		}),
		{ LINEAR_API_KEY: "recorded-linear-key" },
		async (base) => {
			report = (await (
				await fetch(new URL("/api/projects/Widget%20launch", base))
			).json()) as ProjectReport;
		},
	);
	if (report === null) {
		throw new Error("the project report did not load");
	}
	return report;
}

export const cardOf = (key: string) => projectNodeId("Widget launch", key);
export const frameOfKey = (key: string) => frameId(cardOf(key));

export function inside(inner: Rect, outer: Rect): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

/** Each ticket key with the parent ticket keys above it, nearest first. */
export const chains: Record<string, string[]> = {
	"WID-2": ["WID-1"],
	"WID-3": ["WID-2", "WID-1"],
	"WID-4": ["WID-3", "WID-2", "WID-1"],
	"WID-5": ["WID-3", "WID-2", "WID-1"],
	"WID-6": ["WID-2", "WID-1"],
	"WID-7": ["WID-1"],
	"WID-8": ["WID-7", "WID-1"],
	"WID-9": ["WID-7", "WID-1"],
	"WID-11": ["WID-10"],
	"WID-12": ["WID-10"],
};

/** Each card that sits outside a frame it belongs in, as `card / frame`. */
export function strayCards(
	layout: GraphLayout,
	keys: readonly string[],
): string[] {
	return keys.flatMap((key) => {
		const place = layout.cards.get(cardOf(key));
		if (place === undefined) {
			return [`${key} / no card`];
		}
		const box = { ...place, ...card };
		return (chains[key] ?? []).flatMap((parent) => {
			const frame = layout.frames.get(frameOfKey(parent));
			return frame !== undefined && inside(box, frame)
				? []
				: [`${key} / ${parent}`];
		});
	});
}

export function frameOverlaps(
	input: LayoutInput,
	layout: GraphLayout,
): string[] {
	const frames = input.frames.flatMap((frame) => {
		const box = layout.frames.get(frame.id);
		return box === undefined ? [] : [{ frame, box }];
	});
	return frames.flatMap((left, index) =>
		frames
			.slice(index + 1)
			.filter(
				(right) =>
					right.frame.parent === left.frame.parent &&
					overlap(left.box, right.box),
			)
			.map((right) => `${left.frame.head} / ${right.frame.head}`),
	);
}

export function cardOverlaps(layout: GraphLayout): string[] {
	const boxes = [...layout.cards].map(
		([id, place]) => [id, { ...place, ...card }] as const,
	);
	return boxes.flatMap(([id, box], index) =>
		boxes
			.slice(index + 1)
			.filter(([, other]) => overlap(box, other))
			.map(([other]) => `${id} / ${other}`),
	);
}

export function overlap(left: Rect, right: Rect): boolean {
	return (
		left.x < right.x + right.width &&
		right.x < left.x + left.width &&
		left.y < right.y + right.height &&
		right.y < left.y + left.height
	);
}
