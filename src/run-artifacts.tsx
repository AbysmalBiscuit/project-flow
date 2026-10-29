import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { control } from "./control-styles.ts";
import type {
	RunArtifact,
	RunArtifactContent,
	ShownFactoryRun,
} from "./domain.ts";
import { Loading } from "./loading.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { NotServed } from "./run-checkpoint.tsx";
import {
	artifactBinaryLabel,
	artifactMissingLabel,
	artifactSizeLabel,
	noRunArtifactsLabel,
	noRunDataLabel,
	runArtifactsLabel,
	runTabData,
} from "./terms.ts";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	groups: {
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
	stage: {
		color: colours.ink,
		fontWeight: type.weight,
	},
	folder: {
		color: colours.inkSoft,
		fontFamily: font.mono,
		overflowWrap: "anywhere",
	},
	list: {
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	item: {
		paddingBlock: space.xs,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.laneLine,
		fontSize: type.meta,
	},
	row: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "baseline",
		cursor: "pointer",
	},
	name: {
		color: colours.ink,
		fontFamily: font.mono,
		overflowWrap: "anywhere",
	},
	meta: {
		color: colours.inkSoft,
	},
	content: {
		margin: `${space.xs} 0 0`,
		padding: space.sm,
		overflowX: "auto",
		borderRadius: radius.sm,
		backgroundColor: colours.surfaceMuted,
		color: colours.ink,
		fontFamily: font.mono,
		fontSize: type.meta,
		whiteSpace: "pre-wrap",
		overflowWrap: "anywhere",
	},
});

/** The artifacts of each stage folder, in the order that the factory lists them. */
function byFolder(artifacts: RunArtifact[]): RunArtifact[][] {
	const groups = Map.groupBy(artifacts, (artifact) => artifact.folder);
	return [...groups.values()];
}

/** A JSON artifact shows indented. Text that does not parse shows as it is. */
function shownText(artifact: RunArtifactContent): string {
	if (artifact.type !== "application/json") {
		return artifact.content;
	}
	try {
		return JSON.stringify(JSON.parse(artifact.content), null, 2);
	} catch {
		return artifact.content;
	}
}

function ArtifactContent({
	run,
	artifact,
}: {
	run: ShownFactoryRun;
	artifact: RunArtifact;
}) {
	const { data } = useQuery(pageQuery.artifact(run.id, artifact));
	if (data === undefined) {
		return <Loading />;
	}
	if (data === null) {
		return <p className={clsx(panel.note)}>{artifactMissingLabel}</p>;
	}
	if (data.encoding !== "utf-8") {
		return <p className={clsx(panel.note)}>{artifactBinaryLabel}</p>;
	}
	return (
		<pre className={clsx(styles.content)} data-artifact-content="">
			{shownText(data)}
		</pre>
	);
}

/** One artifact, which reads its content when Lev opens it. */
function ArtifactRow({
	run,
	artifact,
}: {
	run: ShownFactoryRun;
	artifact: RunArtifact;
}) {
	const [open, setOpen] = useState(false);
	return (
		<details onToggle={(event) => setOpen(event.currentTarget.open)}>
			<summary
				className={clsx(
					styles.row,
					control.clear,
					control.bleed,
					control.focus,
				)}
			>
				<span className={clsx(styles.name)}>{artifact.name}</span>
				<span className={clsx(styles.meta)}>{artifact.type}</span>
				<span className={clsx(styles.meta)}>
					{artifactSizeLabel(artifact.size)}
				</span>
			</summary>
			{open ? <ArtifactContent run={run} artifact={artifact} /> : null}
		</details>
	);
}

/** The artifacts of a run by stage folder. Each artifact opens to show its content. */
export function RunArtifacts({ run }: { run: ShownFactoryRun }) {
	const { data } = useQuery(pageQuery.artifacts(run));
	if (data === undefined) {
		return <Loading />;
	}
	if (data === "not served") {
		return <NotServed data={runTabData.artifacts} />;
	}
	if (data === "missing") {
		return <p className={clsx(panel.note)}>{noRunDataLabel}</p>;
	}
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runArtifactsLabel}</h3>
			{data.length === 0 ? (
				<p className={clsx(panel.note)}>{noRunArtifactsLabel}</p>
			) : (
				<ul className={clsx(styles.groups)} aria-label={runArtifactsLabel}>
					{byFolder(data).map((group) => {
						const [first] = group;
						if (first === undefined) {
							return null;
						}
						return (
							<li key={first.folder} data-folder={first.folder}>
								<h4 className={clsx(styles.heading)}>
									<span className={clsx(styles.stage)}>{first.stage}</span>
									<span className={clsx(styles.folder)}>{first.folder}</span>
								</h4>
								<ul className={clsx(styles.list)}>
									{group.map((artifact) => (
										<li
											key={artifact.name}
											className={clsx(styles.item)}
											data-artifact={artifact.name}
										>
											<ArtifactRow run={run} artifact={artifact} />
										</li>
									))}
								</ul>
							</li>
						);
					})}
				</ul>
			)}
		</>
	);
}
