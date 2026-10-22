import { afterAll, describe, expect, test } from "bun:test";
import ELK from "elkjs/lib/elk-api.js";
import type { ProjectReport } from "../src/domain.ts";
import { flowGap } from "../src/graph-flow.ts";
import {
	groupHead,
	groupId,
	groupPad,
	layoutGraph,
	layoutInput,
	type Rect,
} from "../src/graph-layout.ts";

const elk = new ELK({
	workerFactory: () =>
		new Worker(require.resolve("elkjs/lib/elk-worker.min.js")),
});
afterAll(() => elk.terminateWorker());

const card = { width: 220, height: 96 };
const workcell = (await Bun.file(
	new URL("./fixtures/workcell-graph-report.json", import.meta.url),
).json()) as ProjectReport;

async function workcellLayout(direction: "left-to-right" | "top-to-bottom") {
	const input = layoutInput(workcell, "workstream", []);
	const layout = await layoutGraph(elk, input, direction, card, () => 0);
	return { input, layout };
}

function fillShare(cards: number, frame: Rect): number {
	const cells =
		((frame.width - groupPad * 2) * (frame.height - groupHead - groupPad)) /
		(flowGap.along * flowGap.across);
	return cards / cells;
}

function overlap(left: Rect, right: Rect): boolean {
	return (
		left.x < right.x + right.width &&
		right.x < left.x + left.width &&
		left.y < right.y + right.height &&
		right.y < left.y + left.height
	);
}

describe("project graph layout", () => {
	test("each workcell workstream frame fills at least the share the elkjs spike recorded", async () => {
		// `proof/elk-spike/measure.ts` prints these shares for ELK `layered` again.
		const recorded: Record<string, number> = {
			"no workstream": 0.71,
			"AbysmalBiscuit/workcell#654": 0.42,
			"AbysmalBiscuit/workcell#69": 0.3,
			"AbysmalBiscuit/workcell#80": 0.4,
			"AbysmalBiscuit/workcell#697": 0.46,
			"AbysmalBiscuit/workcell#150": 0.79,
			"AbysmalBiscuit/workcell#237": 0.63,
		};
		const { input, layout } = await workcellLayout("left-to-right");
		const shares = Object.fromEntries(
			Object.keys(recorded).map((band) => {
				const frame = layout.groups.get(groupId(band));
				const cards = input.cards.filter(
					(item) => item.group === groupId(band),
				).length;
				const share = frame === undefined ? 0 : fillShare(cards, frame);
				return [band, Math.round(share * 100) / 100];
			}),
		);
		const sparse = Object.entries(recorded).flatMap(([band, share]) =>
			(shares[band] ?? 0) < share
				? [`${band}: ${shares[band]} < ${share}`]
				: [],
		);
		expect(sparse).toEqual([]);
	});

	test("sibling group frames do not overlap", async () => {
		for (const direction of ["left-to-right", "top-to-bottom"] as const) {
			const { layout } = await workcellLayout(direction);
			const frames = [...layout.groups];
			expect(frames.length).toBeGreaterThan(1);
			const overlapping = frames.flatMap(([id, frame], index) =>
				frames
					.slice(index + 1)
					.filter(([, other]) => overlap(frame, other))
					.map(([other]) => `${id} / ${other}`),
			);
			expect({ direction, overlapping }).toEqual({
				direction,
				overlapping: [],
			});
		}
	});
});
