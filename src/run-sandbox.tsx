import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";

import type { RunDetail } from "./domain.ts";
import { Loading } from "./loading.tsx";
import { RunFact } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { NotServed } from "./run-checkpoint.tsx";
import {
	aheadLabel,
	hubQueueLabel,
	noBaseLabel,
	noRunDataLabel,
	runSandboxLabel,
	runTabData,
	sandboxFactLabel,
	sandboxStateLabel,
} from "./terms.ts";
import { colours, font, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	mono: {
		fontFamily: font.mono,
		overflowWrap: "anywhere",
	},
	changes: {
		margin: 0,
		padding: space.sm,
		overflowX: "auto",
		borderRadius: radius.sm,
		backgroundColor: colours.surfaceMuted,
		color: colours.ink,
		fontFamily: font.mono,
		fontSize: type.meta,
		whiteSpace: "pre",
	},
});

function Mono({ value }: { value: string }) {
	return <span className={clsx(styles.mono)}>{value}</span>;
}

/** Where a run does its work: the box, the worktree, the branch, the base and the workspace state. */
export function RunSandbox({ run }: { run: RunDetail }) {
	const { data } = useQuery(pageQuery.sandbox(run));
	if (data === undefined) {
		return <Loading />;
	}
	if (data === "not served") {
		return <NotServed data={runTabData.sandbox} />;
	}
	if (data === "missing") {
		return <p className={clsx(panel.note)}>{noRunDataLabel}</p>;
	}
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runSandboxLabel}</h3>
			<dl className={clsx(panel.facts)} data-sandbox-state={data.state}>
				<RunFact label={sandboxFactLabel.box}>
					{run.box ?? hubQueueLabel}
				</RunFact>
				<RunFact label={sandboxFactLabel.host}>
					<Mono value={data.host} />
				</RunFact>
				<RunFact label={sandboxFactLabel.state}>
					{sandboxStateLabel[data.state]}
				</RunFact>
				{data.worktree === null ? null : (
					<RunFact label={sandboxFactLabel.worktree}>
						<Mono value={data.worktree} />
					</RunFact>
				)}
				{data.branch === null ? null : (
					<RunFact label={sandboxFactLabel.branch}>
						<Mono value={data.branch} />
					</RunFact>
				)}
				{data.head === null ? null : (
					<RunFact label={sandboxFactLabel.head}>
						<Mono value={data.head.slice(0, 12)} />
					</RunFact>
				)}
				{data.state === "clean" || data.state === "dirty" ? (
					<RunFact label={sandboxFactLabel.base}>
						{data.base === null ? noBaseLabel : <Mono value={data.base} />}
					</RunFact>
				) : null}
				{data.ahead === null ? null : (
					<RunFact label={sandboxFactLabel.ahead}>
						{aheadLabel(data.ahead)}
					</RunFact>
				)}
			</dl>
			{data.changes.length === 0 ? null : (
				<>
					<h3 className={clsx(panel.sectionLabel)}>
						{sandboxFactLabel.changes}
					</h3>
					<pre className={clsx(styles.changes)} data-sandbox-changes="">
						{data.changes.join("\n")}
					</pre>
				</>
			)}
		</>
	);
}
