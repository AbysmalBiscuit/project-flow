import { since } from "./factories-tiles.tsx";
import { listDetail } from "./list-detail-styles.ts";
import { runResultLabel } from "./terms.ts";
import { ticketLabel } from "./ticket-key.ts";
import { clsx } from "./ui.ts";
import type { CheckRow, VerificationPage } from "./verification-page.ts";
import { styles } from "./verification-styles.ts";
import { verificationCopy } from "./workflows-terms.ts";

export function NotServed({ factories }: { factories: string[] }) {
	return factories.map((factory) => (
		<p key={factory} className={clsx(styles.note)}>
			{verificationCopy.notServed(factory)}
		</p>
	));
}

export function ChecksTable({
	checks,
	blank,
	empty,
}: {
	checks: CheckRow[];
	blank: number;
	empty: string;
}) {
	if (checks.length === 0) {
		return <p className={clsx(styles.empty)}>{empty}</p>;
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
						const last = blank === 0 && index === checks.length - 1;
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
									title={check.topFailure ?? undefined}
								>
									{check.topFailure ?? verificationCopy.noFailure}
								</td>
							</tr>
						);
					})}
					<BlankRows count={blank} />
				</tbody>
			</table>
		</div>
	);
}

export function Reasons({
	reasons,
	blank,
	empty,
}: {
	reasons: VerificationPage["reasons"];
	blank: number;
	empty: string;
}) {
	if (reasons.length === 0) {
		return <p className={clsx(styles.empty)}>{empty}</p>;
	}
	const { columns } = verificationCopy;
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.reason}</th>
						<th className={clsx(styles.th, styles.number)}>{columns.items}</th>
					</tr>
				</thead>
				<tbody>
					{reasons.map((reason, index) => {
						const last = blank === 0 && index === reasons.length - 1;
						return (
							<tr key={reason.reason} className={clsx(styles.row)}>
								<td className={clsx(styles.td, last && styles.lastRow)}>
									{reason.reason}
								</td>
								<td
									className={clsx(
										styles.td,
										styles.number,
										last && styles.lastRow,
									)}
								>
									{reason.items}
								</td>
							</tr>
						);
					})}
					<BlankRows count={blank} />
				</tbody>
			</table>
		</div>
	);
}

export function RunsList({
	runs,
	blank,
	picked,
	onPick,
}: {
	runs: VerificationPage["runs"];
	blank: number;
	picked: string | null;
	onPick: (id: string) => void;
}) {
	if (runs.length === 0) {
		return <p className={clsx(styles.empty)}>{verificationCopy.noRuns}</p>;
	}
	const { columns } = verificationCopy;
	const now = Date.now();
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{verificationCopy.run}</th>
						<th className={clsx(styles.th)}>{columns.result}</th>
						<th className={clsx(styles.th)}>{columns.ended}</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((run, index) => {
						const isPicked = run.id === picked;
						const last = blank === 0 && index === runs.length - 1;
						return (
							<tr
								key={run.id}
								className={clsx(styles.row, isPicked && listDetail.rowPicked)}
								aria-selected={isPicked}
								onClick={() => onPick(run.id)}
							>
								<td
									className={clsx(
										styles.td,
										styles.nowrap,
										last && styles.lastRow,
									)}
								>
									{run.ticket === null ? run.id : ticketLabel(run.ticket)}
								</td>
								<td className={clsx(styles.td, last && styles.lastRow)}>
									{run.result === null ? null : (
										<span className={clsx(styles.pill)}>
											{runResultLabel[run.result]}
										</span>
									)}
								</td>
								<td
									className={clsx(
										styles.td,
										styles.nowrap,
										last && styles.lastRow,
									)}
								>
									{since(run.endedAt, now)}
								</td>
							</tr>
						);
					})}
					<BlankRows count={blank} />
				</tbody>
			</table>
		</div>
	);
}

function BlankRows({ count }: { count: number }) {
	return Array.from({ length: count }, (_, index) => (
		<tr
			// biome-ignore lint/suspicious/noArrayIndexKey: blank rows have no identity
			key={index}
			className={clsx(styles.fixedRow)}
		/>
	));
}
