import type * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import type { RunResult } from "./kinds.ts";
import { pageQuery } from "./queries-page.ts";
import { runResultLabel } from "./terms.ts";
import { ticketLabel } from "./ticket-key.ts";
import { clsx } from "./ui.ts";
import { Card, Sources } from "./verification-card.tsx";
import type {
	ReviewLine,
	RunVerification,
	VerificationRound,
} from "./verification-page.ts";
import { styles } from "./verification-styles.ts";
import { verificationCopy } from "./workflows-terms.ts";

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

export const resultTone: Record<RunResult, stylex.StyleXStyles | false> = {
	merged: styles.pillOk,
	prOpen: false,
	noPr: false,
	failed: styles.pillBad,
	cancelled: false,
};

function RunRecord({ run }: { run: RunVerification }) {
	const [chosen, setChosen] = useState<number | null>(null);
	const last = run.rounds.length - 1;
	const shown = run.rounds[chosen ?? last];
	return (
		<Card
			title={
				<>
					{verificationCopy.run}{" "}
					<span className={clsx(styles.mono)}>
						{run.ticket === null ? run.id : ticketLabel(run.ticket)}
					</span>
				</>
			}
			head={
				<>
					{run.result === null ? null : (
						<span className={clsx(styles.pill, resultTone[run.result])}>
							{runResultLabel[run.result]}
						</span>
					)}
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

export function PickedRun({ runId }: { runId: string }) {
	const query = useQuery(pageQuery.verificationRun(runId));
	return query.data === undefined ? null : (
		<RunRecord key={runId} run={query.data} />
	);
}
