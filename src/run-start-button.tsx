import { useState } from "react";

import { Button } from "./button.tsx";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import type { RunStart } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { useStartRun } from "./queries.ts";
import { runStartCopy } from "./terms.ts";
import type { TicketRef } from "./ticket-key.ts";
import { clsx } from "./ui.ts";

/** Start run for a ticket that can start one. Lev confirms, and the app adds the ready label. */
export function RunStartButton({
	ticket,
	start,
}: {
	ticket: TicketRef;
	start: RunStart;
}) {
	const [asking, setAsking] = useState(false);
	const startRun = useStartRun(ticket.tracker, ticket.project, ticket.key);
	const requested = start.requested === true;
	return (
		<div className={clsx(panel.runAction)} data-run-start={ticket.key}>
			<Button
				label={
					requested
						? runStartCopy.requested
						: startRun.isPending
							? runStartCopy.pending
							: runStartCopy.action
				}
				tone="primary"
				disabled={requested || startRun.isPending}
				onClick={() => setAsking(true)}
			/>
			{startRun.error === null ? null : (
				<p className={clsx(panel.error)}>{startRun.error.message}</p>
			)}
			<ConfirmDialog
				id={`run-start-dialog-${ticket.key}`}
				open={asking}
				title={runStartCopy.title}
				body={(ticket.tracker === "linear"
					? runStartCopy.linearBody
					: runStartCopy.body)(start.factory, start.label)}
				confirmLabel={runStartCopy.action}
				onCancel={() => setAsking(false)}
				onConfirm={() => {
					setAsking(false);
					startRun.mutate();
				}}
			/>
		</div>
	);
}
