/**
 * Measures elkjs `layered` and `stress` on recorded project reports.
 *
 * Usage: bun proof/elk-spike/measure.ts DATA_DIR OUT_DIR
 *
 * DATA_DIR holds the files that `proof/elk-spike/capture.ts` writes. The script
 * prints the tables and writes one SVG page per drawn layout into OUT_DIR.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ELK, { type ElkNode } from "elkjs/lib/elk-api.js";
import type { ProjectReport } from "../../src/domain.ts";
import { projectNodeId } from "../../src/graph-flow.ts";
import { checkLayout, elkPage, frameCount, type Rect, rects } from "./check.ts";
import {
	allCards,
	card,
	cell,
	type ElkSettings,
	elkGraph,
	everyTicket,
	frameCards,
	framePad,
	type Recorded,
	recordedParents,
	type SpikeGraph,
	spikeGraph,
} from "./graph.ts";
import {
	type FillRow,
	fillShare,
	handPage,
	handWritten,
} from "./handwritten.ts";

const [dataDir, outDir] = process.argv.slice(2);
if (
	dataDir === undefined ||
	outDir === undefined ||
	dataDir.trim() === "" ||
	outDir.trim() === ""
) {
	console.error("usage: bun proof/elk-spike/measure.ts DATA_DIR OUT_DIR");
	process.exit(1);
}
await mkdir(outDir, { recursive: true });

const projects = ["project-flow", "workcell", "Initial SDI Issues"] as const;
const reports = await Promise.all(
	projects.map(async (_, index) => {
		const text = await readFile(
			join(dataDir, `report-${index}-all.json`),
			"utf8",
		);
		const report: ProjectReport = JSON.parse(text);
		return report;
	}),
);
const recorded: Recorded[] = JSON.parse(
	await readFile(join(dataDir, "recorded.json"), "utf8"),
);
const parents = recordedParents(recorded);

const workerPath = require.resolve("elkjs/lib/elk-worker.min.js");
const freshElk = () => new ELK({ workerFactory: () => new Worker(workerPath) });

const spacing: ElkSettings = {
	"elk.spacing.nodeNode": String(cell.height - card.height),
	"elk.layered.spacing.nodeNodeBetweenLayers": String(cell.width - card.width),
	"elk.spacing.componentComponent": String(cell.height - card.height),
};
const coords: ElkSettings = {
	"elk.json.shapeCoords": "ROOT",
	"elk.json.edgeCoords": "ROOT",
};
const layeredBase: ElkSettings = {
	"elk.algorithm": "layered",
	"elk.direction": "RIGHT",
	"elk.hierarchyHandling": "INCLUDE_CHILDREN",
	"elk.edgeRouting": "ORTHOGONAL",
	...spacing,
};
const separateCoffmanGraham = {
	name: "SEPARATE_CHILDREN + COFFMAN_GRAHAM layerBound 4",
	options: {
		"elk.hierarchyHandling": "SEPARATE_CHILDREN",
		"elk.layered.layering.strategy": "COFFMAN_GRAHAM",
		"elk.layered.layering.coffmanGraham.layerBound": "4",
	},
};
const layeredVariants: { name: string; options: ElkSettings }[] = [
	{ name: "default", options: {} },
	{
		name: "nodePlacement NETWORK_SIMPLEX",
		options: { "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX" },
	},
	{
		name: "layering COFFMAN_GRAHAM layerBound 4",
		options: {
			"elk.layered.layering.strategy": "COFFMAN_GRAHAM",
			"elk.layered.layering.coffmanGraham.layerBound": "4",
		},
	},
	{
		name: "layering MIN_WIDTH upperBoundOnWidth 4",
		options: {
			"elk.layered.layering.strategy": "MIN_WIDTH",
			"elk.layered.layering.minWidth.upperBoundOnWidth": "4",
		},
	},
	{
		name: "wrapping MULTI_EDGE aspectRatio 1.6",
		options: {
			"elk.layered.wrapping.strategy": "MULTI_EDGE",
			"elk.aspectRatio": "1.6",
		},
	},
	{
		name: "highDegreeNodes treatment, threshold 8",
		options: {
			"elk.layered.highDegreeNodes.treatment": "true",
			"elk.layered.highDegreeNodes.threshold": "8",
			"elk.layered.highDegreeNodes.treeHeight": "2",
		},
	},
	separateCoffmanGraham,
	{
		name: "SEPARATE_CHILDREN + COFFMAN_GRAHAM 4 + NETWORK_SIMPLEX placement",
		options: {
			"elk.hierarchyHandling": "SEPARATE_CHILDREN",
			"elk.layered.layering.strategy": "COFFMAN_GRAHAM",
			"elk.layered.layering.coffmanGraham.layerBound": "4",
			"elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
		},
	},
	{
		name: "SEPARATE_CHILDREN, default layering",
		options: { "elk.hierarchyHandling": "SEPARATE_CHILDREN" },
	},
	{
		name: "COFFMAN_GRAHAM 4 + NETWORK_SIMPLEX placement",
		options: {
			"elk.layered.layering.strategy": "COFFMAN_GRAHAM",
			"elk.layered.layering.coffmanGraham.layerBound": "4",
			"elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
		},
	},
];
const stressBase: ElkSettings = {
	"elk.algorithm": "stress",
	"elk.stress.desiredEdgeLength": String(cell.width),
	...spacing,
};

async function timed(
	elk: InstanceType<typeof ELK>,
	graph: ElkNode,
): Promise<{ ms: number; laid: ElkNode }> {
	const started = performance.now();
	const laid = await elk.layout(structuredClone(graph));
	return { ms: performance.now() - started, laid };
}

function median(values: number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const round = (value: number) => Math.round(value);
const percent = (value: number) => `${Math.round(value * 100)} %`;

function elkFill(graph: SpikeGraph, laid: Map<string, Rect>): FillRow[] {
	return graph.groups.map((group) => {
		const box = laid.get(group.id) ?? { x: 0, y: 0, width: 0, height: 0 };
		const cards = frameCards(group).length;
		return {
			name: group.label,
			cards,
			share: fillShare(cards, {
				width: box.width - framePad.side * 2,
				height: box.height - framePad.head - framePad.side,
			}),
		};
	});
}

function totalShare(rows: { cards: number; share: number }[]): number {
	const cells = rows.reduce((sum, row) => sum + row.cards / row.share, 0);
	return rows.reduce((sum, row) => sum + row.cards, 0) / cells;
}

const forceWorker = () => new Worker(join(import.meta.dir, "force-worker.ts"));

function forceTimed(
	worker: Worker,
	graph: Omit<SpikeGraph, "tickets">,
): Promise<{ ms: number; laid: ElkNode }> {
	const started = performance.now();
	return new Promise((resolve, reject) => {
		worker.onmessage = (event: MessageEvent<ElkNode>) =>
			resolve({ ms: performance.now() - started, laid: event.data });
		worker.onerror = (event) => reject(new Error(event.message));
		worker.postMessage(graph);
	});
}

const separateGroups: ElkSettings = {
	...layeredBase,
	...separateCoffmanGraham.options,
};
const engines = {
	layered: { options: layeredBase, lift: false },
	"layered, groups apart": { options: separateGroups, lift: false },
	stress: { options: stressBase, lift: false },
	"stress, lifted arrows": { options: stressBase, lift: true },
	"d3-force": { options: {}, lift: false },
} as const;
type Engine = keyof typeof engines;
const engineNames = Object.keys(engines) as Engine[];

function startEngine(engine: Engine, graph: SpikeGraph) {
	if (engine === "d3-force") {
		const { tickets: _tickets, ...forceGraph } = graph;
		const worker = forceWorker();
		return {
			run: () => forceTimed(worker, forceGraph),
			stop: () => worker.terminate(),
		};
	}
	const { options, lift } = engines[engine];
	const input = elkGraph(graph, { ...options, ...coords }, options, lift);
	const elk = freshElk();
	return {
		run: () => timed(elk, input),
		stop: () => elk.terminateWorker(),
	};
}

// 1. Layout time of `layered` and `stress`, in a Web Worker, with nested frames.
console.log(
	"## Layout time in a Web Worker (ms), parent ticket frames nested to full depth\n",
);
console.log(
	`| Project | Tickets | Group by | Cards | Arrows | Frames | Depth | ${engineNames.map((name) => `${name} cold | ${name} warm`).join(" | ")} |`,
);
console.log(
	`|---|---|---|---|---|---|---|${engineNames.map(() => "---|---|").join("")}`,
);
const laidOut = new Map<
	string,
	{ graph: SpikeGraph; laid: Map<Engine, ElkNode> }
>();
for (const [index, name] of projects.entries()) {
	const shownReport = reports[index];
	if (shownReport === undefined) {
		continue;
	}
	for (const [ticketSet, report] of [
		["graph", shownReport],
		["all", everyTicket(shownReport)],
	] as const) {
		for (const groupBy of ["workstream", "theme"] as const) {
			const graph = spikeGraph(report, parents, groupBy, true);
			const laid = new Map<Engine, ElkNode>();
			const times: string[] = [];
			for (const engine of engineNames) {
				const { run, stop } = startEngine(engine, graph);
				const cold = await run();
				const warm: number[] = [];
				for (let again = 0; again < 5; again += 1) {
					warm.push((await run()).ms);
				}
				stop();
				laid.set(engine, cold.laid);
				times.push(`${round(cold.ms)} | ${round(median(warm))}`);
			}
			laidOut.set(`${name}\n${ticketSet}\n${groupBy}`, { graph, laid });
			const cards = allCards(graph).length;
			console.log(
				`| ${name} | ${ticketSet} | ${groupBy} | ${cards} | ${graph.edges.length} | ${frameCount(graph.groups)} | ${graph.depth} | ${times.join(" | ")} |`,
			);
		}
	}
}

// 2. Group fill share on workcell: hand-written against ELK `layered` variants.
const workcell = reports[1];
if (workcell === undefined) {
	throw new Error("workcell report missing");
}
console.log(
	"\n## Group fill share on workcell (cards / cells in the group frame)\n",
);
for (const groupBy of ["workstream", "theme"] as const) {
	const hand = handWritten(workcell, groupBy).groups;
	console.log(`\n### Group by ${groupBy}\n`);
	console.log("| Layout | Frames | All groups | Worst group | Largest group |");
	console.log("|---|---|---|---|---|");
	const describe = (label: string, frames: string, rows: FillRow[]) => {
		const worst = [...rows].sort((left, right) => left.share - right.share)[0];
		const largest = [...rows].sort(
			(left, right) => right.cards - left.cards,
		)[0];
		console.log(
			`| ${label} | ${frames} | ${percent(totalShare(rows))} | ${worst === undefined ? "" : `${percent(worst.share)} (${worst.cards} cards)`} | ${largest === undefined ? "" : `${percent(largest.share)} (${largest.cards} cards)`} |`,
		);
	};
	describe("hand-written", "groups only", hand);
	const perGroup = new Map<string, Map<string, number>>();
	const remember = (
		column: string,
		rows: { name: string; share: number }[],
	) => {
		for (const row of rows) {
			const known = perGroup.get(row.name) ?? new Map<string, number>();
			known.set(column, row.share);
			perGroup.set(row.name, known);
		}
	};
	remember("hand-written", hand);
	for (const nested of [false, true]) {
		const graph = spikeGraph(workcell, parents, groupBy, nested);
		for (const variant of layeredVariants) {
			const options = { ...layeredBase, ...variant.options };
			const elk = freshElk();
			const laid = await elk.layout(
				elkGraph(graph, { ...options, ...coords }, options),
			);
			elk.terminateWorker();
			const rows = elkFill(graph, rects(laid));
			describe(
				`layered ${variant.name}`,
				nested ? "groups + parent frames" : "groups only",
				rows,
			);
			if (!nested) {
				remember(variant.name, rows);
			}
			if (
				!nested &&
				(variant.name === "default" ||
					variant.name === separateCoffmanGraham.name)
			) {
				const slug = variant.name === "default" ? "default" : "best";
				await writeFile(
					join(outDir, `workcell-layered-${slug}-${groupBy}.html`),
					elkPage(
						`workcell, Group by ${groupBy}, ELK layered (${variant.name})`,
						graph,
						laid,
						false,
					),
				);
			}
		}
	}
	const columns = ["hand-written", "default", separateCoffmanGraham.name];
	console.log(`\n| Group | Cards | ${columns.join(" | ")} |`);
	console.log(`|---|---|${columns.map(() => "---|").join("")}`);
	const cardsOf = new Map(hand.map((group) => [group.name, group.cards]));
	for (const [group, shares] of [...perGroup].sort(
		(left, right) => (cardsOf.get(right[0]) ?? 0) - (cardsOf.get(left[0]) ?? 0),
	)) {
		console.log(
			`| ${group.replaceAll("|", "/")} | ${cardsOf.get(group) ?? ""} | ${columns
				.map((column) => {
					const share = shares.get(column);
					return share === undefined ? "" : percent(share);
				})
				.join(" | ")} |`,
		);
	}
	await writeFile(
		join(outDir, `workcell-handwritten-${groupBy}.html`),
		handPage(
			`workcell, Group by ${groupBy}, hand-written layout`,
			workcell,
			groupBy,
		),
	);
}

// 3. Fan-out of workcell#657 under each `layered` variant.
console.log(
	"\n## Fan-out of workcell#657 (Group by Workstream, groups only)\n",
);
console.log(
	"| Variant | Blocked tickets | In their largest group | Columns | Most in one column | Rows spanned | All groups fill |",
);
console.log("|---|---|---|---|---|---|---|");
const fanSource = projectNodeId(
	"AbysmalBiscuit/workcell",
	"AbysmalBiscuit/workcell#657",
);
for (const variant of layeredVariants) {
	const graph = spikeGraph(workcell, parents, "workstream", false);
	const options = { ...layeredBase, ...variant.options };
	const elk = freshElk();
	const laid = rects(
		await elk.layout(elkGraph(graph, { ...options, ...coords }, options)),
	);
	elk.terminateWorker();
	const groupOf = new Map(
		graph.groups.flatMap((group) =>
			frameCards(group).map((id) => [id, group.id] as const),
		),
	);
	const targets = graph.edges
		.filter((edge) => edge.from === fanSource)
		.map((edge) => edge.to);
	const homes = new Map<string, number>();
	for (const id of targets) {
		const home = groupOf.get(id) ?? "";
		homes.set(home, (homes.get(home) ?? 0) + 1);
	}
	const [mainGroup] = [...homes].sort(
		(left, right) => right[1] - left[1],
	)[0] ?? [""];
	const blocked = targets
		.filter((id) => groupOf.get(id) === mainGroup)
		.flatMap((id) => {
			const box = laid.get(id);
			return box === undefined ? [] : [box];
		});
	const perColumn = new Map<number, number>();
	for (const box of blocked) {
		perColumn.set(
			Math.round(box.x),
			(perColumn.get(Math.round(box.x)) ?? 0) + 1,
		);
	}
	const top = Math.min(...blocked.map((box) => box.y));
	const bottom = Math.max(...blocked.map((box) => box.y + box.height));
	console.log(
		`| ${variant.name} | ${targets.length} | ${blocked.length} | ${perColumn.size} | ${Math.max(...perColumn.values())} | ${((bottom - top + cell.height - card.height) / cell.height).toFixed(1)} | ${percent(totalShare(elkFill(graph, laid)))} |`,
	);
}

// 4. Force: frame check and arrow readability, ELK `stress` against `layered`.
console.log("\n## Frame check and arrows across frames (nested frames)\n");
console.log(
	"| Project | Tickets | Group by | Layout | Cards inside a foreign frame | Sibling frame overlaps | Card overlaps | Arrows across frames | Arrows through a card | Mean arrow length (cells) | Area (cells) |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const [key, entry] of laidOut) {
	const [name, ticketSet, groupBy] = key.split("\n");
	for (const engine of engineNames) {
		const check = checkLayout(
			entry.graph,
			entry.laid.get(engine) ?? { id: "root" },
			engine !== "layered",
		);
		console.log(
			`| ${name} | ${ticketSet} | ${groupBy} | ${engine} | ${check.intruders} | ${check.siblingOverlaps} | ${check.cardOverlaps} | ${check.crossFrameArrows} | ${check.arrowsThroughCards} | ${check.meanArrowCells.toFixed(1)} | ${round(check.areaCells)} |`,
		);
	}
}
for (const [name, slug, ticketSet] of [
	["workcell", "workcell", "graph"],
	["Initial SDI Issues", "sdi", "all"],
] as const) {
	const entry = laidOut.get(`${name}\n${ticketSet}\nworkstream`);
	if (entry === undefined) {
		continue;
	}
	for (const engine of engineNames) {
		const tickets = ticketSet === "all" ? "every ticket" : "graph tickets";
		const how = engine === "d3-force" ? "d3-force" : `ELK ${engine}`;
		await writeFile(
			join(
				outDir,
				`${slug}-${engine.replaceAll(/[ ,]+/g, "-")}-workstream.html`,
			),
			elkPage(
				`${name}, ${tickets}, Group by Workstream, nested frames, ${how}`,
				entry.graph,
				entry.laid.get(engine) ?? { id: "root" },
				engine !== "layered",
			),
		);
	}
}
console.log(`\nPages: ${outDir}`);
process.exit(0);
