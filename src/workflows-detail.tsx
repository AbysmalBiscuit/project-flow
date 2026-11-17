import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { pageQuery } from "./queries-page.ts";
import { colours, measure, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { Sha, Since, type Tab, tabs } from "./workflows-cards.tsx";
import { Diagram } from "./workflows-diagram.tsx";
import type { WorkflowCard } from "./workflows-page.ts";
import { styles } from "./workflows-styles.ts";
import { RolesTable, RunsTable, StagesTable } from "./workflows-tables.tsx";
import { workflowsCopy } from "./workflows-terms.ts";

const detailStyles = stylex.create({
	sourceFirst: {
		marginLeft: "auto",
	},
	sourceNeed: {
		backgroundColor: colours.warnWash,
		color: colours.warn,
	},
	tabs: {
		display: "flex",
		gap: space.twoXs,
		marginBottom: space.md,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.laneLine,
	},
	tab: {
		padding: `${space.xs} ${space.sm}`,
		borderWidth: 0,
		borderBottomWidth: measure.focus,
		borderBottomStyle: "solid",
		borderBottomColor: "transparent",
		backgroundColor: "transparent",
		color: colours.inkMuted,
		font: "inherit",
		fontSize: type.menu,
		cursor: "pointer",
	},
	tabOn: {
		borderBottomColor: colours.ink,
		color: colours.ink,
		fontWeight: type.weight,
	},
});

export function Detail({ card }: { card: WorkflowCard }) {
	const [picked, setTab] = useState<Tab>("diagram");
	const detail = useQuery(pageQuery.workflow(card.package, card.sha)).data;
	const roles = detail?.roles ?? null;
	const shownTabs = tabs.filter((item) => item !== "roles" || roles !== null);
	const tab = shownTabs.includes(picked) ? picked : "diagram";
	return (
		<section className={clsx(styles.card)} aria-label={card.package}>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{card.package}</h2>
				<Sha sha={card.sha} prefix />
				<Since card={card} />
				<span
					className={clsx(
						styles.source,
						styles.sourceOwn,
						detailStyles.sourceFirst,
					)}
				>
					{workflowsCopy.source}
				</span>
				{roles === null ? (
					<span className={clsx(styles.source, detailStyles.sourceNeed)}>
						{workflowsCopy.needsPackages}
					</span>
				) : null}
			</div>
			<div
				className={clsx(detailStyles.tabs)}
				role="tablist"
				aria-label={workflowsCopy.tabsLabel}
			>
				{shownTabs.map((item) => (
					<button
						key={item}
						type="button"
						role="tab"
						aria-selected={item === tab}
						className={clsx(
							detailStyles.tab,
							item === tab && detailStyles.tabOn,
						)}
						onClick={() => setTab(item)}
					>
						{workflowsCopy.tabs[item]}
					</button>
				))}
			</div>
			{detail === undefined ? null : tab === "diagram" ? (
				<Diagram detail={detail} />
			) : tab === "stages" ? (
				<StagesTable stages={detail.stages} />
			) : tab === "roles" && roles !== null ? (
				<RolesTable roles={roles} />
			) : (
				<RunsTable runs={detail.runs} />
			)}
		</section>
	);
}
