import * as stylex from "@stylexjs/stylex";

import { spanText } from "./factories-terms.ts";
import { listDetail } from "./list-detail-styles.ts";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { Sha, Since, versionKey } from "./workflows-cards.tsx";
import type { WorkflowCard } from "./workflows-page.ts";
import { workflowsCopy } from "./workflows-terms.ts";

const styles = stylex.create({
	empty: {
		margin: 0,
		color: colours.inkSoft,
		fontSize: type.small,
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
	fixedRow: {
		height: measure.listRow,
	},
	name: {
		marginRight: space.xs,
		fontWeight: type.weight,
	},
	chip: {
		display: "inline-flex",
		alignItems: "center",
		padding: `${space.twoXs} ${space.sm}`,
		borderRadius: radius.pill,
		backgroundColor: colours.chip,
		color: colours.chipInk,
		fontFamily: font.mono,
		fontSize: type.pill,
		whiteSpace: "nowrap",
	},
});

/** One row per workflow package version. A row click picks the version; `data-key` lets the tab scroll back to it. */
export function VersionsTable({
	rows,
	blank,
	latest,
	picked,
	reading,
	now,
	onPick,
}: {
	rows: WorkflowCard[];
	blank: number;
	latest: ReadonlySet<string>;
	picked: string | null;
	reading: boolean;
	now: number;
	onPick: (key: string) => void;
}) {
	if (rows.length === 0) {
		return <p className={clsx(styles.empty)}>{workflowsCopy.noMatch}</p>;
	}
	const { columns, stats } = workflowsCopy;
	return (
		<div className={clsx(styles.scroll)}>
			<table className={clsx(styles.table)}>
				<thead>
					<tr>
						<th className={clsx(styles.th)}>{columns.package}</th>
						<th className={clsx(styles.th)}>{columns.version}</th>
						<th className={clsx(styles.th)}>{columns.since}</th>
						<th className={clsx(styles.th)}>{columns.lastRun}</th>
						<th className={clsx(styles.th, styles.number)}>{columns.runs}</th>
						<th className={clsx(styles.th, styles.number)}>
							{reading ? stats.mergedReading : columns.merged}
						</th>
						<th className={clsx(styles.th, styles.number)}>{columns.median}</th>
						<th className={clsx(styles.th, styles.number)}>{columns.perRun}</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((card, index) => {
						const key = versionKey(card);
						const last = index === rows.length - 1 && blank === 0;
						const cell = (...more: (stylex.StyleXStyles | false)[]) =>
							clsx(styles.td, last && styles.lastRow, ...more);
						return (
							<tr
								key={key}
								data-key={key}
								className={clsx(
									styles.row,
									key === picked && listDetail.rowPicked,
								)}
								onClick={() => onPick(key)}
								aria-selected={key === picked}
							>
								<td className={cell(styles.nowrap)}>
									<span className={clsx(styles.name)}>{card.package}</span>
									{latest.has(key) && (
										<span className={clsx(styles.chip)}>
											{workflowsCopy.latest}
										</span>
									)}
								</td>
								<td className={cell(styles.nowrap)}>
									<Sha sha={card.sha} />
								</td>
								<td className={cell(styles.nowrap)}>
									<Since card={card} />
								</td>
								<td className={cell(styles.nowrap)}>
									{card.lastRunAt === null
										? workflowsCopy.noRunYet
										: workflowsCopy.lastRun(
												spanText(now - Date.parse(card.lastRunAt)),
											)}
								</td>
								<td className={cell(styles.number)}>{card.runs}</td>
								<td className={cell(styles.number)}>
									{card.mergeRate === null
										? workflowsCopy.none
										: workflowsCopy.share(card.mergeRate)}
								</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{workflowsCopy.seconds(card.medianS)}
								</td>
								<td className={cell(styles.number, styles.nowrap)}>
									{workflowsCopy.cost(card.costPerRun)}
								</td>
							</tr>
						);
					})}
					{Array.from({ length: blank }, (_, index) => (
						<tr
							// biome-ignore lint/suspicious/noArrayIndexKey: blank rows have no identity
							key={index}
							className={clsx(styles.fixedRow)}
						/>
					))}
				</tbody>
			</table>
		</div>
	);
}
