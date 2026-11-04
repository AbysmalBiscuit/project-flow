import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { textControl } from "./control-styles.ts";
import type { RunResult } from "./kinds.ts";
import { pageQuery } from "./queries.ts";
import { PageFrame } from "./shell.tsx";
import { navLabel, runResultLabel, verificationCopy } from "./terms.ts";
import {
	colours,
	font,
	measure,
	media,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import type {
	CheckRow,
	ReviewLine,
	RunVerification,
	VerificationPage,
	VerificationRound,
} from "./verification-page.ts";

const styles = stylex.create({
	grid: {
		display: "grid",
		gap: space.lg,
		marginBottom: space.lg,
	},
	tiles: {
		gridTemplateColumns: `repeat(auto-fit, minmax(${measure.tileMin}, 1fr))`,
	},
	two: {
		gridTemplateColumns: {
			default: "minmax(0, 2fr) minmax(0, 1fr)",
			[media.phone]: "minmax(0, 1fr)",
		},
	},
	half: {
		gridTemplateColumns: {
			default: "minmax(0, 1fr) minmax(0, 1fr)",
			[media.phone]: "minmax(0, 1fr)",
		},
		marginBottom: 0,
	},
	card: {
		boxSizing: "border-box",
		minWidth: 0,
		padding: space.lg,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
	},
	kicker: {
		color: colours.inkSoft,
		fontSize: type.kicker,
		letterSpacing: type.kickerTrack,
		textTransform: "uppercase",
	},
	sectionKicker: {
		marginBottom: space.xs,
	},
	tileValue: {
		color: colours.ink,
		fontSize: type.tileValue,
		fontWeight: type.weight,
		fontVariantNumeric: "tabular-nums",
	},
	tileWarn: {
		color: colours.warn,
	},
	tileDetail: {
		color: colours.inkSoft,
		fontSize: type.meta,
		overflowWrap: "anywhere",
	},
	head: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "center",
		marginBottom: space.md,
	},
	heading: {
		margin: 0,
		color: colours.ink,
		fontSize: type.heading,
		fontWeight: type.weight,
	},
	mono: {
		fontFamily: font.mono,
	},
	sources: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		marginLeft: "auto",
	},
	source: {
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.tag,
		whiteSpace: "nowrap",
	},
	sourceStore: {
		backgroundColor: colours.chip,
		color: colours.chipInk,
	},
	pill: {
		display: "inline-flex",
		flexShrink: 0,
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.surfaceMuted,
		color: colours.inkMuted,
		fontSize: type.pill,
		fontWeight: type.weight,
		whiteSpace: "nowrap",
	},
	pillOk: {
		backgroundColor: colours.okWash,
		color: colours.awaitingMerge,
	},
	pillWarn: {
		backgroundColor: colours.warnWash,
		color: colours.warn,
	},
	pillBad: {
		backgroundColor: colours.dangerWash,
		color: colours.danger,
	},
	scroll: {
		overflowX: "auto",
	},
	table: {
		width: "100%",
		borderCollapse: "collapse",
		fontVariantNumeric: "tabular-nums",
	},
	th: {
		padding: space.sm,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.laneLine,
		color: colours.inkSoft,
		fontSize: type.lane,
		fontWeight: type.weight,
		letterSpacing: type.headTrack,
		textAlign: "left",
		textTransform: "uppercase",
		whiteSpace: "nowrap",
	},
	row: {
		backgroundColor: {
			default: null,
			":hover": colours.surface,
		},
	},
	td: {
		padding: space.sm,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		color: colours.ink,
		fontSize: type.menu,
		verticalAlign: "middle",
	},
	lastRow: {
		borderBottomWidth: 0,
	},
	number: {
		textAlign: "right",
	},
	nowrap: {
		whiteSpace: "nowrap",
	},
	failure: {
		minWidth: measure.failureMin,
		color: colours.inkSoft,
		fontSize: type.meter,
		overflowWrap: "anywhere",
	},
	strip: {
		display: "flex",
		gap: measure.stepGap,
	},
	cell: {
		flexShrink: 0,
		width: measure.stripCell,
		height: measure.stripCellHeight,
		borderRadius: radius.cell,
		backgroundColor: colours.awaitingMerge,
	},
	cellFailed: {
		backgroundColor: colours.danger,
	},
	list: {
		margin: 0,
		padding: 0,
		listStyle: "none",
	},
	item: {
		display: "flex",
		gap: space.sm,
		alignItems: "baseline",
		padding: `${space.sm} 0`,
		borderBottomWidth: {
			default: measure.hairline,
			":last-child": 0,
		},
		borderBottomStyle: "solid",
		borderBottomColor: colours.line,
		color: colours.ink,
		fontSize: type.menu,
	},
	itemBody: {
		minWidth: 0,
		overflowWrap: "anywhere",
	},
	reason: {
		display: "block",
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	where: {
		marginLeft: "auto",
		paddingLeft: space.sm,
		color: colours.inkSoft,
		fontFamily: font.mono,
		fontSize: type.lane,
		whiteSpace: "nowrap",
	},
	dot: {
		flexShrink: 0,
		alignSelf: "center",
		width: measure.resultDot,
		height: measure.resultDot,
		borderRadius: radius.pill,
		backgroundColor: colours.awaitingMerge,
	},
	dotBad: {
		backgroundColor: colours.danger,
	},
	tabs: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.xs,
		marginBottom: space.md,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.laneLine,
	},
	tab: {
		padding: `${space.xs} ${space.sm}`,
		borderWidth: 0,
		borderBottomWidth: measure.underline,
		borderBottomStyle: "solid",
		borderBottomColor: "transparent",
		backgroundColor: "transparent",
		color: colours.inkMuted,
		cursor: "pointer",
		fontFamily: "inherit",
		fontSize: type.menu,
	},
	tabOn: {
		borderBottomColor: colours.ink,
		color: colours.ink,
		fontWeight: type.weight,
	},
	section: {
		marginTop: space.md,
	},
	note: {
		margin: `${space.sm} 0 0`,
		color: colours.inkSoft,
		fontSize: type.small,
	},
	empty: {
		margin: 0,
		color: colours.inkSoft,
		fontSize: type.small,
	},
	picker: {
		maxWidth: measure.panel,
		fontSize: type.small,
	},
});

const pickedRun = (): string | null =>
	new URLSearchParams(window.location.search).get("run");

function Sources({ route, store }: { route?: string; store?: string }) {
	return (
		<span className={clsx(styles.sources)}>
			{route === undefined ? null : (
				<span className={clsx(styles.source)}>{route}</span>
			)}
			{store === undefined ? null : (
				<span className={clsx(styles.source, styles.sourceStore)}>{store}</span>
			)}
		</span>
	);
}

function Card({
	title,
	head,
	children,
}: {
	title: ReactNode;
	head: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className={clsx(styles.card)}>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{title}</h2>
				{head}
			</div>
			{children}
		</section>
	);
}

function Tile({
	label,
	value,
	detail,
	warn = false,
}: {
	label: string;
	value: string;
	detail: string;
	warn?: boolean;
}) {
	return (
		<div className={clsx(styles.card)}>
			<div className={clsx(styles.kicker)}>{label}</div>
			<div className={clsx(styles.tileValue, warn && styles.tileWarn)}>
				{value}
			</div>
			<div className={clsx(styles.tileDetail)}>{detail}</div>
		</div>
	);
}

function Tiles({ tiles }: { tiles: VerificationPage["tiles"] }) {
	const { firstRound, rejected, failLines, ci } = tiles;
	return (
		<div className={clsx(styles.grid, styles.tiles)}>
			<Tile
				label={verificationCopy.tiles.firstRound}
				value={verificationCopy.percent(firstRound.verified, firstRound.items)}
				detail={verificationCopy.firstRoundDetail(firstRound.items)}
			/>
			<Tile
				label={verificationCopy.tiles.rejected}
				value={String(rejected.items)}
				detail={verificationCopy.mostOften(rejected.topReason)}
				warn={rejected.items > 0}
			/>
			<Tile
				label={verificationCopy.tiles.failLines}
				value={verificationCopy.perRun(failLines.lines, failLines.runs)}
				detail={verificationCopy.highSeverity(
					verificationCopy.perRun(failLines.high, failLines.runs),
				)}
			/>
			<Tile
				label={verificationCopy.tiles.ci}
				value={verificationCopy.percent(ci.passed, ci.runs)}
				detail={verificationCopy.firstPush(
					verificationCopy.percent(ci.firstPush, ci.runs),
				)}
			/>
		</div>
	);
}

function NotServed({ factories }: { factories: string[] }) {
	return factories.map((factory) => (
		<p key={factory} className={clsx(styles.note)}>
			{verificationCopy.notServed(factory)}
		</p>
	));
}

function ChecksTable({ checks }: { checks: CheckRow[] }) {
	if (checks.length === 0) {
		return <p className={clsx(styles.empty)}>{verificationCopy.noChecks}</p>;
	}
	const { columns } = verificationCopy;
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.check}</th>
						<th className={clsx(styles.th)}>{columns.kind}</th>
						<th className={clsx(styles.th, styles.number)}>
							{columns.passRate}
						</th>
						<th className={clsx(styles.th)}>{columns.last}</th>
						<th className={clsx(styles.th)}>{columns.topFailure}</th>
					</tr>
				</thead>
				<tbody>
					{checks.map((check, index) => {
						const last = index === checks.length - 1;
						const cell = clsx(styles.td, last && styles.lastRow);
						return (
							<tr
								key={`${check.kind} ${check.name}`}
								className={clsx(styles.row)}
							>
								<td
									className={clsx(
										styles.td,
										styles.nowrap,
										last && styles.lastRow,
									)}
								>
									{check.name}
								</td>
								<td className={cell}>
									<span className={clsx(styles.pill)}>{check.kind}</span>
								</td>
								<td
									className={clsx(
										styles.td,
										styles.number,
										last && styles.lastRow,
									)}
								>
									{verificationCopy.percent(check.passed, check.total)}
								</td>
								<td className={cell}>
									<span className={clsx(styles.strip)}>
										{check.last.map((passed, at) => (
											<i
												// biome-ignore lint/suspicious/noArrayIndexKey: a result has no id, and the strip only grows at its end.
												key={at}
												className={clsx(
													styles.cell,
													!passed && styles.cellFailed,
												)}
											/>
										))}
									</span>
								</td>
								<td
									className={clsx(
										styles.td,
										styles.failure,
										last && styles.lastRow,
									)}
								>
									{check.topFailure ?? verificationCopy.noFailure}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function Reasons({ reasons }: { reasons: VerificationPage["reasons"] }) {
	if (reasons.length === 0) {
		return <p className={clsx(styles.empty)}>{verificationCopy.noReasons}</p>;
	}
	return (
		<ul className={clsx(styles.list)}>
			{reasons.map((reason) => (
				<li key={reason.reason} className={clsx(styles.item)}>
					<span className={clsx(styles.itemBody)}>{reason.reason}</span>
					<span className={clsx(styles.where)}>{reason.items}</span>
				</li>
			))}
		</ul>
	);
}

const verdictTone = (verdict: string) =>
	verdict === "verified"
		? styles.pillOk
		: verdict === "rejected" || verdict === "error"
			? styles.pillBad
			: styles.pillWarn;

const reviewTone: Record<ReviewLine["state"], stylex.StyleXStyles> = {
	fail: styles.pillBad,
	kept: styles.pillWarn,
	fixed: styles.pillOk,
};

function List<T>({
	items,
	empty,
	children,
}: {
	items: T[];
	empty: string;
	children: (item: T) => ReactNode;
}) {
	if (items.length === 0) {
		return <p className={clsx(styles.empty)}>{empty}</p>;
	}
	return <ul className={clsx(styles.list)}>{items.map(children)}</ul>;
}

function Round({ round }: { round: VerificationRound }) {
	return (
		<div className={clsx(styles.grid, styles.half)}>
			<div>
				<div className={clsx(styles.kicker, styles.sectionKicker)}>
					{verificationCopy.doneWhen}
				</div>
				<List items={round.doneWhen} empty={verificationCopy.noDoneWhen}>
					{(item) => (
						<li key={item.number} className={clsx(styles.item)}>
							<span className={clsx(styles.pill, verdictTone(item.verdict))}>
								{item.verdict}
							</span>
							<span className={clsx(styles.itemBody)}>
								{item.text}
								{item.reason === "" ? null : (
									<span className={clsx(styles.reason)}>{item.reason}</span>
								)}
							</span>
						</li>
					)}
				</List>
			</div>
			<div>
				<div className={clsx(styles.kicker, styles.sectionKicker)}>
					{verificationCopy.reviewCheck}
				</div>
				<List items={round.reviewCheck} empty={verificationCopy.noReviewCheck}>
					{(line) => (
						<li
							key={`${line.state} ${line.path} ${line.line} ${line.text}`}
							className={clsx(styles.item)}
						>
							<span className={clsx(styles.pill, reviewTone[line.state])}>
								{verificationCopy.reviewState[line.state]}
							</span>
							<span className={clsx(styles.itemBody)}>
								{line.text}{" "}
								{line.severity === null ? null : (
									<span className={clsx(styles.pill)}>{line.severity}</span>
								)}
							</span>
							<span className={clsx(styles.where)}>
								{verificationCopy.where(line.path, line.line)}
							</span>
						</li>
					)}
				</List>
				<div
					className={clsx(styles.kicker, styles.sectionKicker, styles.section)}
				>
					{verificationCopy.gates}
				</div>
				<List items={round.gates} empty={verificationCopy.noGates}>
					{(gate) => (
						<li key={gate.name} className={clsx(styles.item)}>
							<span
								className={clsx(styles.dot, !gate.passed && styles.dotBad)}
							/>
							<span className={clsx(styles.itemBody)}>{gate.name}</span>
							<span className={clsx(styles.where)}>
								{gate.detail ?? gate.result}
							</span>
						</li>
					)}
				</List>
			</div>
		</div>
	);
}

const resultTone: Record<RunResult, stylex.StyleXStyles | false> = {
	merged: styles.pillOk,
	prOpen: false,
	noPr: false,
	failed: styles.pillBad,
	cancelled: false,
};

function RunRecord({
	run,
	runs,
	pick,
}: {
	run: RunVerification;
	runs: VerificationPage["runs"];
	pick: (id: string) => void;
}) {
	const [chosen, setChosen] = useState<number | null>(null);
	const last = run.rounds.length - 1;
	const shown = run.rounds[chosen ?? last];
	return (
		<Card
			title={
				<>
					{verificationCopy.run}{" "}
					<span className={clsx(styles.mono)}>{run.ticket ?? run.id}</span>
				</>
			}
			head={
				<>
					{run.result === null ? null : (
						<span className={clsx(styles.pill, resultTone[run.result])}>
							{runResultLabel[run.result]}
						</span>
					)}
					{runs.length > 1 ? (
						<select
							className={clsx(styles.picker, ...textControl)}
							aria-label={verificationCopy.pickRun}
							value={run.id}
							onChange={(event) => pick(event.target.value)}
						>
							{runs.map((item) => (
								<option key={item.id} value={item.id}>
									{item.ticket}
									{item.result === null
										? ""
										: `, ${runResultLabel[item.result]}`}
								</option>
							))}
						</select>
					) : null}
					<Sources route={verificationCopy.sources.route} />
				</>
			}
		>
			{run.notServed ? (
				<p className={clsx(styles.empty)}>{verificationCopy.runNotServed}</p>
			) : shown === undefined ? (
				<p className={clsx(styles.empty)}>{verificationCopy.noRecord}</p>
			) : (
				<>
					<div className={clsx(styles.tabs)} role="tablist">
						{run.rounds
							.map((round, index) => ({ round, index }))
							.reverse()
							.map(({ round, index }) => (
								<button
									key={round.round}
									type="button"
									role="tab"
									aria-selected={round === shown}
									className={clsx(styles.tab, round === shown && styles.tabOn)}
									onClick={() => setChosen(index)}
								>
									{verificationCopy.round(round.round, index === last)}
								</button>
							))}
					</div>
					<Round round={shown} />
				</>
			)}
		</Card>
	);
}

function PickedRun({
	runId,
	runs,
	pick,
}: {
	runId: string;
	runs: VerificationPage["runs"];
	pick: (id: string) => void;
}) {
	const query = useQuery(pageQuery.verificationRun(runId));
	return query.data === undefined ? null : (
		<RunRecord key={runId} run={query.data} runs={runs} pick={pick} />
	);
}

export function Page() {
	const query = useQuery(pageQuery.verification);
	const [picked, setPicked] = useState(pickedRun);
	const page = query.data;
	const pick = (id: string) => {
		const url = new URL(window.location.href);
		url.searchParams.set("run", id);
		window.history.replaceState(null, "", url);
		setPicked(id);
	};
	const runId = picked ?? page?.runs[0]?.id ?? null;
	return (
		<PageFrame
			title={navLabel.verification}
			subtitle={verificationCopy.subtitle}
		>
			{page === undefined ? null : (
				<>
					<Tiles tiles={page.tiles} />
					<div className={clsx(styles.grid, styles.two)}>
						<Card
							title={verificationCopy.checks}
							head={
								<Sources
									route={verificationCopy.sources.route}
									store={verificationCopy.sources.aggregate}
								/>
							}
						>
							<ChecksTable checks={page.checks} />
							<NotServed factories={page.notServed} />
						</Card>
						<Card
							title={verificationCopy.reasons}
							head={<Sources store={verificationCopy.sources.store} />}
						>
							<Reasons reasons={page.reasons} />
						</Card>
					</div>
					{runId === null ? (
						<Card
							title={verificationCopy.run}
							head={<Sources route={verificationCopy.sources.route} />}
						>
							<p className={clsx(styles.empty)}>{verificationCopy.noRuns}</p>
							<NotServed factories={page.notServed} />
						</Card>
					) : (
						<PickedRun runId={runId} runs={page.runs} pick={pick} />
					)}
				</>
			)}
		</PageFrame>
	);
}
