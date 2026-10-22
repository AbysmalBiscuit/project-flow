/** The hand-written layout of the project graph, and the fill share of a frame. */
import type { ProjectReport } from "../../src/domain.ts";
import { projectFlowPlaces, projectNodeId } from "../../src/graph-flow.ts";
import type { GroupBy } from "../../src/view-settings.ts";
import { type Rect, shortKey, svgPage } from "./check.ts";
import { card, cell, framePad } from "./graph.ts";

/** Share of the cells in a frame that hold a card, with one cell per card and gap. */
export function fillShare(
	cards: number,
	inner: { width: number; height: number },
): number {
	const gapX = cell.width - card.width;
	const gapY = cell.height - card.height;
	return (
		(cards * cell.width * cell.height) /
		((inner.width + gapX) * (inner.height + gapY))
	);
}

/**
 * Mirrors `layoutTickets` in `src/graph-model.ts`, which is private and also
 * measures DOM labels, so the spike cannot call it from Bun.
 */
export function handWritten(report: ProjectReport, groupBy: GroupBy) {
	const placed = projectFlowPlaces(report, groupBy, []);
	const byBand = new Map<string, { id: string; x: number; y: number }[]>();
	for (const [id, place] of placed) {
		const members = byBand.get(place.band) ?? [];
		members.push({ id, x: place.x, y: place.row * cell.height });
		byBand.set(place.band, members);
	}
	const positions = new Map<string, { x: number; y: number }>();
	const groups: { name: string; cards: number; share: number; box: Rect }[] =
		[];
	let origin = 0;
	for (const band of [...byBand.keys()].sort((left, right) =>
		left.localeCompare(right),
	)) {
		const members = byBand.get(band) ?? [];
		const minX = Math.min(...members.map((member) => member.x));
		const minY = Math.min(...members.map((member) => member.y));
		const maxX = Math.max(...members.map((member) => member.x));
		const maxY = Math.max(...members.map((member) => member.y));
		for (const member of members) {
			positions.set(member.id, {
				x: member.x - minX + origin,
				y: member.y - minY,
			});
		}
		if (!band.startsWith("\u0000")) {
			const inner = {
				width: maxX - minX + card.width,
				height: maxY - minY + card.height,
			};
			groups.push({
				name: band,
				cards: members.length,
				share: fillShare(members.length, inner),
				box: {
					x: origin - framePad.side,
					y: -framePad.head,
					width: inner.width + framePad.side * 2,
					height: inner.height + framePad.head + framePad.side,
				},
			});
		}
		origin += maxX - minX + cell.width + framePad.side * 2;
	}
	return { positions, groups };
}

export function handPage(
	title: string,
	report: ProjectReport,
	groupBy: GroupBy,
): string {
	const { positions, groups } = handWritten(report, groupBy);
	const cards = [...positions].map(([id, place]) => ({
		id,
		label: shortKey(id),
		box: { x: place.x, y: place.y, width: card.width, height: card.height },
		outside: !id.toLowerCase().startsWith(`${report.name.toLowerCase()}\n`),
	}));
	const at = new Map(cards.map((item) => [item.id, item.box]));
	const arrows = report.graphLinks.flatMap((link) => {
		const from = at.get(projectNodeId(link.from.project, link.from.key));
		const to = at.get(projectNodeId(link.to.project, link.to.key));
		return from === undefined || to === undefined
			? []
			: [
					[
						{ x: from.x + from.width, y: from.y + from.height / 2 },
						{ x: to.x, y: to.y + to.height / 2 },
					],
				];
	});
	return svgPage(
		title,
		groups.map((group) => ({
			id: group.name,
			label: group.name,
			box: group.box,
		})),
		cards,
		arrows,
	);
}
