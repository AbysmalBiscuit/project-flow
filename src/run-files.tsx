import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";

import { textControl } from "./control-styles.ts";
import type { RunFile, ShownFactoryRun } from "./domain.ts";
import { Loading } from "./loading.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { NotServed } from "./run-checkpoint.tsx";
import {
	noRunDataLabel,
	noRunFilesLabel,
	renamedPathLabel,
	runFilesCountLabel,
	runFilesGoneLabel,
	runFilesLabel,
	runFileStatusLabel,
	runTabData,
	runTabLabel,
	uncommittedChangesLabel,
} from "./terms.ts";
import { colours, font, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	files: {
		display: "flex",
		flexDirection: "column",
		gap: space.sm,
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	summary: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "baseline",
		margin: 0,
		fontSize: type.meta,
	},
	toggle: {
		cursor: "pointer",
	},
	path: {
		color: colours.ink,
		fontFamily: font.mono,
		fontWeight: type.weight,
		overflowWrap: "anywhere",
	},
	meta: {
		color: colours.inkSoft,
	},
	added: {
		color: colours.saved,
	},
	deleted: {
		color: colours.danger,
	},
	patch: {
		margin: `${space.xs} 0 0`,
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
	hunk: {
		color: colours.inkSoft,
	},
});

/** The style of one patch line, by its first character. File header lines keep the plain style. */
function lineStyle(line: string) {
	if (line.startsWith("+++") || line.startsWith("---")) {
		return null;
	}
	if (line.startsWith("+")) {
		return styles.added;
	}
	if (line.startsWith("-")) {
		return styles.deleted;
	}
	if (line.startsWith("@@")) {
		return styles.hunk;
	}
	return null;
}

function LineCounts({
	additions,
	deletions,
}: {
	additions: number;
	deletions: number;
}) {
	return (
		<>
			<span className={clsx(styles.added)}>+{additions}</span>
			<span className={clsx(styles.deleted)}>-{deletions}</span>
		</>
	);
}

function FileDiff({ file }: { file: RunFile }) {
	return (
		<li data-file={file.path} data-status={file.status}>
			<details open>
				<summary
					className={clsx(styles.summary, styles.toggle, ...textControl)}
				>
					<span className={clsx(styles.path)}>
						{file.previousPath === undefined
							? file.path
							: renamedPathLabel(file.previousPath, file.path)}
					</span>
					<span className={clsx(styles.meta)}>
						{runFileStatusLabel[file.status]}
					</span>
					<LineCounts additions={file.additions} deletions={file.deletions} />
				</summary>
				<pre className={clsx(styles.patch)}>
					{file.patch
						.replace(/\n$/, "")
						.split("\n")
						.map((line, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: a patch can repeat a line, and its lines never move
							<span key={index} className={clsx(lineStyle(line))}>
								{`${line}\n`}
							</span>
						))}
				</pre>
			</details>
		</li>
	);
}

/** The uncommitted changes of the worktree are in the run sandbox. */
function SandboxNote({ onSandbox }: { onSandbox: () => void }) {
	return (
		<p className={clsx(panel.note)}>
			{uncommittedChangesLabel}{" "}
			<a
				className={clsx(panel.factLink, ...textControl)}
				href="?tab=sandbox"
				onClick={(event) => {
					event.preventDefault();
					onSandbox();
				}}
			>
				{runTabLabel.sandbox}
			</a>
		</p>
	);
}

/** Each file that the run's branch committed since its base, with its status, its line counts and its diff. */
export function RunFiles({
	run,
	onSandbox,
}: {
	run: ShownFactoryRun;
	onSandbox: () => void;
}) {
	const { data } = useQuery(pageQuery.files(run));
	if (data === undefined) {
		return <Loading />;
	}
	if (data === "not served") {
		return <NotServed data={runTabData.files} />;
	}
	if (data === "missing") {
		return <p className={clsx(panel.note)}>{noRunDataLabel}</p>;
	}
	if (data === "gone") {
		return <p className={clsx(panel.note)}>{runFilesGoneLabel}</p>;
	}
	if (data.length === 0) {
		return (
			<>
				<p className={clsx(panel.note)}>{noRunFilesLabel}</p>
				<SandboxNote onSandbox={onSandbox} />
			</>
		);
	}
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runFilesLabel}</h3>
			<p className={clsx(styles.summary)}>
				<span className={clsx(styles.meta)}>
					{runFilesCountLabel(data.length)}
				</span>
				<LineCounts
					additions={data.reduce((sum, file) => sum + file.additions, 0)}
					deletions={data.reduce((sum, file) => sum + file.deletions, 0)}
				/>
			</p>
			<SandboxNote onSandbox={onSandbox} />
			<ul className={clsx(styles.files)} aria-label={runFilesLabel}>
				{data.map((file) => (
					<FileDiff key={file.path} file={file} />
				))}
			</ul>
		</>
	);
}
