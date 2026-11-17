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

export function ChecksTable({ checks }: { checks: CheckRow[] }) {
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
									title={check.topFailure ?? undefined}
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

export function Reasons({ reasons }: { reasons: VerificationPage["reasons"] }) {
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
