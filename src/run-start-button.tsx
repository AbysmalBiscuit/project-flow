import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import type { RunStart } from "./domain.ts";
import type { FactoryEntry } from "./factories.ts";
import { takesClaim } from "./factory-claim.ts";
import { panel } from "./panel-styles.ts";
import { MergeButton } from "./pull-merge.tsx";
import { pageQuery } from "./queries.ts";
import { useStartRun } from "./run-mutations.ts";
import { SplitButton, type SplitChoice } from "./split-button.tsx";
import { runStartCopy } from "./terms.ts";
import type { TicketRef } from "./ticket-key.ts";
import { clsx } from "./ui.ts";

/** A factory that can claim the ticket, and whether a run starts now or waits for a slot. */
type ClaimChoice = { factory: string; free: boolean };

/** One choice per factory that takes a claimed start of the ticket. */
function claimChoices(entries: readonly FactoryEntry[]): ClaimChoice[] {
	return entries.flatMap((entry) =>
		takesClaim(entry) && entry.slots !== undefined
			? [{ factory: entry.name, free: entry.slots.used < entry.slots.total }]
			: [],
	);
}

function claimLabel({ factory, free }: ClaimChoice): string {
	return (free ? runStartCopy.runOn : runStartCopy.queueOn)(factory);
}

/**
 * Start run for a ticket that can start one. Lev confirms, and the app writes the run start to the ticket.
 * Its menu offers Run on or Queue on each factory, which claims the ticket on that factory.
 * With no ready label, the button only opens that menu.
 */
export function RunStartButton({
	ticket,
	start,
	mergeChoices,
}: {
	ticket: TicketRef;
	start: RunStart;
	mergeChoices: readonly SplitChoice[];
}) {
	const [asking, setAsking] = useState<ClaimChoice | "label" | null>(null);
	const startRun = useStartRun(ticket.tracker, ticket.project, ticket.key);
	const settings = useQuery(pageQuery.settings).data;
	const claims = settings?.trackers?.some(
		(tracker) => tracker.kind === ticket.tracker && tracker.claimsRuns,
	);
	const choices = claims ? claimChoices(settings?.factoryEntries ?? []) : [];
	const requested = start.requested === true;
	const label = requested
		? runStartCopy.requested
		: startRun.isPending
			? runStartCopy.pending
			: runStartCopy.action;
	const disabled = requested || startRun.isPending;
	const labelStart =
		start.factory === undefined ? undefined : () => setAsking("label");
	if (labelStart === undefined && choices.length === 0 && !requested) {
		return <MergeButton choices={mergeChoices} />;
	}
	const menu: SplitChoice[] = [
		...choices.map((choice) => ({
			label: claimLabel(choice),
			disabled,
			onPick: () => setAsking(choice),
		})),
		...mergeChoices,
	];
	return (
		<div className={clsx(panel.runAction)} data-run-start={ticket.key}>
			{menu.length === 0 ? (
				<Button
					label={label}
					tone="primary"
					disabled={disabled || labelStart === undefined}
					{...(labelStart === undefined ? {} : { onClick: labelStart })}
				/>
			) : (
				<SplitButton
					label={label}
					choicesLabel={runStartCopy.choices}
					tone="primary"
					disabled={disabled}
					{...(labelStart === undefined ? {} : { onClick: labelStart })}
					choices={menu}
				/>
			)}
			{startRun.error === null ? null : (
				<p className={clsx(panel.error)}>{startRun.error.message}</p>
			)}
			<ConfirmDialog
				id={`run-start-dialog-${ticket.key}`}
				open={asking !== null}
				title={runStartCopy.title}
				body={
					asking === null || asking === "label"
						? start.factory === undefined
							? ""
							: start.label === undefined
								? runStartCopy.stateBody(start.factory, start)
								: runStartCopy.body(start.factory, start.label)
						: (asking.free ? runStartCopy.runOnBody : runStartCopy.queueOnBody)(
								asking.factory,
							)
				}
				confirmLabel={
					asking === null || asking === "label"
						? runStartCopy.action
						: claimLabel(asking)
				}
				onCancel={() => setAsking(null)}
				onConfirm={() => {
					setAsking(null);
					startRun.mutate(asking === "label" ? undefined : asking?.factory);
				}}
			/>
		</div>
	);
}
