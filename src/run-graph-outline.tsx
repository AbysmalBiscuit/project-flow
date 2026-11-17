import * as stylex from "@stylexjs/stylex";

import { colours, measure, space } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

/** The inner gap of each shape, so that the stage text stays inside the outline. */
export const inset = stylex.create({
	box: { paddingInline: space.sm },
	slant: { paddingInline: "13%" },
	point: { paddingInline: "24%" },
	roof: { paddingInline: space.sm, paddingTop: "18%" },
});

export const insetOf: Record<string, keyof typeof inset> = {
	diamond: "point",
	Mdiamond: "point",
	hexagon: "slant",
	parallelogram: "slant",
	tripleoctagon: "slant",
	house: "roof",
};

type Mark = { points: string; closed: boolean };

/** The outline of each Graphviz shape in a 100 by 100 box: the filled outline, then its marks. */
const outlines: Record<string, Mark[]> = {
	box: [{ points: "0,0 100,0 100,100 0,100", closed: true }],
	Msquare: [
		{ points: "0,0 100,0 100,100 0,100", closed: true },
		{ points: "0,12 6,0", closed: false },
		{ points: "94,0 100,12", closed: false },
		{ points: "0,88 6,100", closed: false },
		{ points: "94,100 100,88", closed: false },
	],
	diamond: [{ points: "50,0 100,50 50,100 0,50", closed: true }],
	Mdiamond: [
		{ points: "50,0 100,50 50,100 0,50", closed: true },
		{ points: "44,12 56,12", closed: false },
		{ points: "44,88 56,88", closed: false },
		{ points: "6,44 6,56", closed: false },
		{ points: "94,44 94,56", closed: false },
	],
	hexagon: [{ points: "10,0 90,0 100,50 90,100 10,100 0,50", closed: true }],
	parallelogram: [{ points: "12,0 100,0 88,100 0,100", closed: true }],
	component: [
		{ points: "4,0 100,0 100,100 4,100", closed: true },
		{ points: "0,20 8,20 8,36 0,36", closed: true },
		{ points: "0,64 8,64 8,80 0,80", closed: true },
	],
	tripleoctagon: [
		{ points: "8,0 92,0 100,24 100,76 92,100 8,100 0,76 0,24", closed: true },
		{ points: "10,6 90,6 97,26 97,74 90,94 10,94 3,74 3,26", closed: false },
		{ points: "12,12 88,12 94,28 94,72 88,88 12,88 6,72 6,28", closed: false },
	],
	house: [{ points: "50,0 100,30 100,100 0,100 0,30", closed: true }],
};

/** The border of a workflow stage in the colour of its agent role. A stage with no role is a tool stage, with a thin border. */
const roleStroke = stylex.create({
	implementer: { stroke: colours.accent },
	verifier: { stroke: colours.awaitingMerge },
	reviewer: { stroke: colours.done },
	receiver: { stroke: colours.warn },
	senior: { stroke: colours.danger },
	manager: { stroke: colours.lineStrong },
	tool: { stroke: colours.inkSoft },
});

const roleOutline = stylex.create({
	other: { stroke: colours.inkMuted },
	all: { fill: colours.raised },
	role: { strokeWidth: measure.focus },
	noRole: { strokeWidth: measure.hairline },
});

const roleStrokes: ReadonlyMap<string, stylex.StyleXStyles> = new Map(
	Object.entries(roleStroke),
);

/** The text of an agent role in the colour of its stage borders. */
const roleInk = stylex.create({
	implementer: { color: colours.accent },
	verifier: { color: colours.awaitingMerge },
	reviewer: { color: colours.done },
	receiver: { color: colours.warn },
	senior: { color: colours.danger },
	manager: { color: colours.lineStrong },
	other: { color: colours.inkMuted },
});

const roleInks: ReadonlyMap<string, stylex.StyleXStyles> = new Map(
	Object.entries(roleInk),
);

export const roleInkOf = (role: string): stylex.StyleXStyles =>
	roleInks.get(role) ?? roleInk.other;

export function roleStrokeOf(role: string | undefined): stylex.StyleXStyles {
	return role === undefined
		? [roleOutline.all, roleOutline.noRole, roleStroke.tool]
		: [
				roleOutline.all,
				roleOutline.role,
				roleStrokes.get(role) ?? roleOutline.other,
			];
}

export function Outline({
	shape,
	stroke,
	layout,
}: {
	shape: string;
	stroke: stylex.StyleXStyles;
	layout: stylex.StyleXStyles;
}) {
	const marks = outlines[shape] ?? outlines.box ?? [];
	return (
		<svg
			aria-hidden="true"
			className={clsx(layout)}
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
		>
			{marks.map((mark, index) =>
				mark.closed ? (
					<polygon
						key={mark.points}
						points={mark.points}
						vectorEffect="non-scaling-stroke"
						className={clsx(stroke)}
					/>
				) : (
					<polyline
						key={mark.points}
						points={mark.points}
						vectorEffect="non-scaling-stroke"
						fill="none"
						className={clsx(stroke)}
						data-mark={index}
					/>
				),
			)}
		</svg>
	);
}
