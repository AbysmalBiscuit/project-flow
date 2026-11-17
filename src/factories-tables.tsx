import * as stylex from "@stylexjs/stylex";

import { textControl } from "./control-styles.ts";
import type {
	AttentionItem,
	FactoriesPage,
	NotServedPanel,
	QueueItem,
	RunningRun,
} from "./factories-page.ts";
import { styles } from "./factories-parts.tsx";
import { AgentWork, Stepper } from "./factories-steps.tsx";
import { factoriesCopy, spanText } from "./factories-terms.ts";
import { since } from "./factories-tiles.tsx";
import { runPagePath } from "./page-links.ts";
import { costLabel } from "./run-terms.ts";
import { ticketLabel } from "./ticket-key.ts";
import { colours, font, measure, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const tableStyles = stylex.create({
	fixedRow: {
		height: measure.listRow,
	},
	blankItem: {
		borderBottomWidth: 0,
	},
	clampOne: {
		display: "block",
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	},
	pillInfo: {
		backgroundColor: colours.chip,
		color: colours.chipInk,
	},
	stagePill: {
		marginLeft: space.xs,
	},
	wrap: {
		overflowWrap: "anywhere",
	},
	link: {
		color: colours.link,
		textDecoration: "none",
	},
	list: {
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	item: {
		boxSizing: "border-box",
		display: "flex",
		gap: space.sm,
		alignItems: "center",
		height: measure.listRow,
		padding: `${space.sm} 0`,
		overflow: "hidden",
		borderBottomWidth: {
			default: measure.hairline,
			":last-child": 0,
		},
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
	},
	itemBody: {
		minWidth: 0,
		color: colours.inkMuted,
		fontSize: type.small,
		overflowWrap: "anywhere",
	},
	where: {
		marginLeft: "auto",
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.lane,
		whiteSpace: "nowrap",
	},
});

export function RunningTable({
	runs,
	blank,
	now,
}: {
	runs: RunningRun[];
	blank: number;
	now: number;
}) {
	if (runs.length === 0) {
		return <p className={clsx(styles.empty)}>{factoriesCopy.noRunning}</p>;
	}
	const { columns } = factoriesCopy;
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.ticket}</th>
						<th className={clsx(styles.th)}>{columns.factory}</th>
						<th className={clsx(styles.th)}>{columns.stages}</th>
						<th className={clsx(styles.th)}>{columns.stage}</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.inStage}
						</th>
						<th className={clsx(styles.th, styles.number)}>{columns.total}</th>
						<th className={clsx(styles.th)}>{columns.agent}</th>
						<th className={clsx(styles.th, styles.number)}>{columns.cost}</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((run, index) => {
						const last = index === runs.length - 1 && blank === 0;
						const cell = (...more: (stylex.StyleXStyles | false)[]) =>
							clsx(styles.td, last && styles.lastRow, ...more);
						return (
							<tr
								key={run.id}
								className={clsx(styles.row, tableStyles.fixedRow)}
							>
								<td className={cell()}>
									<a
										href={runPagePath(run.id)}
										className={clsx(tableStyles.link, ...textControl)}
									>
										{ticketLabel(run.key)}
									</a>
								</td>
								<td className={cell()}>{run.factory}</td>
								<td className={cell()}>
									<Stepper run={run} />
								</td>
								<td className={cell(tableStyles.wrap)}>
									{run.stage}
									{run.stall === undefined ? null : (
										<span
											className={clsx(
												styles.pill,
												styles.pillWarn,
												tableStyles.stagePill,
											)}
										>
											{factoriesCopy.pastP95}
										</span>
									)}
								</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{since(run.stageSince, now)}
								</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{since(run.startedAt, now)}
								</td>
								<td className={cell()}>
									<AgentWork run={run} />
								</td>
								<td className={cell(styles.number)}>
									{run.costUsd === undefined ? null : costLabel(run.costUsd)}
								</td>
							</tr>
						);
					})}
					{Array.from({ length: blank }, (_, index) => (
						<tr
							// biome-ignore lint/suspicious/noArrayIndexKey: blank rows have no identity
							key={index}
							className={clsx(tableStyles.fixedRow)}
						/>
					))}
				</tbody>
			</table>
		</div>
	);
}

const kindPill: Record<AttentionItem["kind"], stylex.StyleXStyles> = {
	failed: styles.pillBad,
	stalled: styles.pillWarn,
	ask: tableStyles.pillInfo,
};

/** A stalled run names its stage, its time in the stage and the p95 that it passed. */
function reasonOf(item: AttentionItem, now: number): string {
	if (item.p95S === undefined) {
		return item.reason;
	}
	const p95Ms = item.p95S * 1_000;
	return factoriesCopy.stalledReason(
		item.reason,
		spanText(now - Date.parse(item.since) + p95Ms),
		spanText(p95Ms),
	);
}

export function AttentionList({
	items,
	blank,
	now,
}: {
	items: AttentionItem[];
	blank: number;
	now: number;
}) {
	if (items.length === 0) {
		return <p className={clsx(styles.empty)}>{factoriesCopy.noAttention}</p>;
	}
	return (
		<ul className={clsx(tableStyles.list)}>
			{items.map((item) => (
				<li
					key={`${item.kind} ${item.runId} ${item.reason}`}
					className={clsx(tableStyles.item)}
				>
					<span className={clsx(styles.pill, kindPill[item.kind])}>
						{factoriesCopy.kind[item.kind]}
					</span>
					<span className={clsx(tableStyles.itemBody)}>
						<a
							href={runPagePath(item.runId)}
							className={clsx(tableStyles.link, ...textControl)}
						>
							{ticketLabel(item.key)}
						</a>
						<span
							className={clsx(tableStyles.clampOne)}
							title={reasonOf(item, now)}
						>
							{reasonOf(item, now)}
						</span>
					</span>
					<span className={clsx(tableStyles.where)}>
						{since(item.since, now)}
					</span>
				</li>
			))}
			{Array.from({ length: blank }, (_, index) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: blank rows have no identity
					key={index}
					aria-hidden="true"
					className={clsx(tableStyles.item, tableStyles.blankItem)}
				/>
			))}
		</ul>
	);
}

export function QueueTable({
	items,
	now,
}: {
	items: QueueItem[];
	now: number;
}) {
	if (items.length === 0) {
		return <p className={clsx(styles.empty)}>{factoriesCopy.noQueue}</p>;
	}
	const { columns } = factoriesCopy;
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.rank}</th>
						<th className={clsx(styles.th)}>{columns.ticket}</th>
						<th className={clsx(styles.th, styles.wide)}>{columns.source}</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.waiting}
						</th>
						<th className={clsx(styles.th)}>{columns.waitsOn}</th>
					</tr>
				</thead>
				<tbody>
					{items.map((item, index) => {
						const last = index === items.length - 1;
						const cell = (...more: (stylex.StyleXStyles | false)[]) =>
							clsx(styles.td, last && styles.lastRow, ...more);
						return (
							<tr
								key={`${item.factory} ${item.source} ${item.key}`}
								className={clsx(styles.row)}
							>
								<td className={cell()}>{item.rank}</td>
								<td className={cell(styles.nowrap)}>
									{item.url === undefined ? (
										ticketLabel(item.key)
									) : (
										<a
											href={item.url}
											target="_blank"
											rel="noreferrer"
											className={clsx(tableStyles.link, ...textControl)}
										>
											{ticketLabel(item.key)}
										</a>
									)}
								</td>
								<td className={cell(styles.wide)}>
									{`${item.factory}: ${item.source}`}
								</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{since(item.since, now)}
								</td>
								<td className={cell()}>
									{item.hold === undefined
										? item.waits
										: factoriesCopy.held(item.hold.failures)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

export function NotServed({
	page,
	panel,
	factory,
}: {
	page: FactoriesPage;
	panel: NotServedPanel["panel"];
	factory?: string;
}) {
	return page.notServed
		.filter(
			(item) =>
				item.panel === panel &&
				(factory === undefined || item.factory === factory),
		)
		.map((item) => (
			<p key={item.factory} className={clsx(styles.note)}>
				{factoriesCopy.notServed(item.factory, item.route)}
			</p>
		));
}
