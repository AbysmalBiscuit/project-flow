import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";

import type { ShownFactoryRun } from "./domain.ts";
import { Loading } from "./loading.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { NotServed } from "./run-checkpoint.tsx";
import {
	calledGraphFileLabel,
	entryGraphLabel,
	noRunDataLabel,
	runSourceLabel,
	runTabData,
} from "./terms.ts";
import { colours, font, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	graphs: {
		display: "flex",
		flexDirection: "column",
		gap: space.md,
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	heading: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "baseline",
		margin: `0 0 ${space.xs}`,
		fontSize: type.meta,
	},
	path: {
		color: colours.ink,
		fontFamily: font.mono,
		fontWeight: type.weight,
		overflowWrap: "anywhere",
	},
	kind: {
		color: colours.inkSoft,
	},
	text: {
		margin: 0,
		padding: space.sm,
		overflowX: "auto",
		borderRadius: radius.sm,
		backgroundColor: colours.surfaceMuted,
		color: colours.ink,
		fontFamily: font.mono,
		fontSize: type.meta,
		fontVariantLigatures: "none",
		whiteSpace: "pre",
	},
});

/** The entry graph file of a run, then each child graph file that it calls. */
export function RunSource({ run }: { run: ShownFactoryRun }) {
	const { data } = useQuery(pageQuery.source(run));
	if (data === undefined) {
		return <Loading />;
	}
	if (data === "not served") {
		return <NotServed data={runTabData.source} />;
	}
	if (data === "missing") {
		return <p className={clsx(panel.note)}>{noRunDataLabel}</p>;
	}
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runSourceLabel}</h3>
			<ul className={clsx(styles.graphs)} aria-label={runSourceLabel}>
				{data.graphs.map((graph) => (
					<li key={graph.path} data-graph={graph.path}>
						<h4 className={clsx(styles.heading)}>
							<span className={clsx(styles.path)}>{graph.path}</span>
							<span className={clsx(styles.kind)}>
								{graph.path === data.entry
									? entryGraphLabel
									: calledGraphFileLabel}
							</span>
						</h4>
						<pre className={clsx(styles.text)}>{graph.text}</pre>
					</li>
				))}
			</ul>
		</>
	);
}
