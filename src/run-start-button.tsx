import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import type { RunStart } from "./domain.ts";
import type { FactoryEntry } from "./factories.ts";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { useStartRun } from "./run-mutations.ts";
import { SplitButton } from "./split-button.tsx";
import { runStartCopy } from "./terms.ts";
import type { TicketRef } from "./ticket-key.ts";
import { clsx } from "./ui.ts";

/** A factory that can claim the ticket, and whether a run starts now or waits for a slot. */
type ClaimChoice = { factory: string; free: boolean };

/**
 * One choice per reachable factory that reports its slots. A box that a hub also reads
 * takes its runs from that hub, so it gives no choice of its own.
 * A claimed start needs the repo of a GitHub ticket.
 */
function claimChoices(
	ticket: TicketRef,
	entries: readonly FactoryEntry[],
): ClaimChoice[] {
	if (ticket.tracker !== "github") {
		return [];
	}
	return entries.flatMap(({ name, reachable, slots, alsoReadThroughHub }) =>
		reachable === true &&
		slots !== undefined &&
		alsoReadThroughHub === undefined
			? [{ factory: name, free: slots.used < slots.total }]
			: [],
	);
}

function claimLabel({ factory, free }: ClaimChoice): string {
	return (free ? runStartCopy.runOn : runStartCopy.queueOn)(factory);
}

/**
 * Start run for a ticket that can start one. Lev confirms, and the app adds the ready label.
 * Its menu offers Run on or Queue on each factory, which claims the ticket on that factory.
 */
export function RunStartButton({
	ticket,
	start,
}: {
	ticket: TicketRef;
	start: RunStart;
}) {
	const [asking, setAsking] = useState<ClaimChoice | "label" | null>(null);
	const startRun = useStartRun(ticket.tracker, ticket.project, ticket.key);
	const entries = useQuery(pageQuery.settings).data?.factoryEntries ?? [];
	const choices = claimChoices(ticket, entries);
	const requested = start.requested === true;
	const label = requested
		? runStartCopy.requested
		: startRun.isPending
			? runStartCopy.pending
			: runStartCopy.action;
	const disabled = requested || startRun.isPending;
	const labelBody =
		ticket.tracker === "linear" ? runStartCopy.linearBody : runStartCopy.body;
	return (
		<div className={clsx(panel.runAction)} data-run-start={ticket.key}>
			{choices.length === 0 ? (
				<Button
					label={label}
					tone="primary"
					disabled={disabled}
					onClick={() => setAsking("label")}
				/>
			) : (
				<SplitButton
					label={label}
					choicesLabel={runStartCopy.choices}
					tone="primary"
					disabled={disabled}
					onClick={() => setAsking("label")}
					choices={choices.map((choice) => ({
						label: claimLabel(choice),
						onPick: () => setAsking(choice),
					}))}
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
						? labelBody(start.factory, start.label)
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
