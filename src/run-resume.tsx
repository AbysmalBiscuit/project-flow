import * as stylex from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";

import { ConfirmDialog } from "./confirm-dialog.tsx";
import { control } from "./control-styles.ts";
import type { RunStatusKind, ShownFactoryRun } from "./domain.ts";
import { Caret, useDismiss } from "./dropdown.tsx";
import { panel } from "./panel-styles.ts";
import { useStartAgain } from "./queries.ts";
import { runResumeCopy } from "./terms.ts";
import { colours, measure, space, type } from "./tokens.stylex.ts";
import { frame, shell } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	resume: {
		display: "flex",
		flexDirection: "column",
		alignItems: "flex-start",
		gap: space.xs,
	},
	split: {
		display: "inline-flex",
	},
	main: {
		borderColor: colours.needs,
		borderTopRightRadius: measure.none,
		borderBottomRightRadius: measure.none,
		backgroundColor: colours.needs,
		color: colours.needsInk,
		fontWeight: type.weight,
	},
	more: {
		display: "inline-flex",
		alignItems: "center",
		paddingInline: space.sm,
		borderLeftWidth: measure.none,
		borderTopLeftRadius: measure.none,
		borderBottomLeftRadius: measure.none,
	},
});

const resumableKinds = [
	"blocked",
	"failed",
] as const satisfies readonly RunStatusKind[];

/**
 * Resume for a blocked or failed run. The main part resumes the run from its run checkpoint.
 * The menu also offers a restart from the first stage, which Lev confirms.
 */
export function RunResume({
	run,
}: {
	run: Pick<ShownFactoryRun, "id" | "statusKind">;
}) {
	const [open, setOpen] = useState(false);
	const [asking, setAsking] = useState(false);
	const menuId = useId();
	const root = useRef<HTMLDivElement>(null);
	const start = useStartAgain(run.id);
	useDismiss(root, open, setOpen);
	if (!resumableKinds.some((kind) => kind === run.statusKind)) {
		return null;
	}
	const pick = (action: "resume" | "restart") => {
		setOpen(false);
		if (action === "restart") {
			setAsking(true);
		} else {
			start.mutate("resume");
		}
	};
	return (
		<div className={clsx(styles.resume)} data-run-resume={run.id}>
			<div className={clsx(frame.menu, styles.split)} ref={root}>
				<button
					type="button"
					className={clsx(
						control.box,
						control.off,
						styles.main,
						shell.buttonFocus,
					)}
					disabled={start.isPending}
					onClick={() => start.mutate("resume")}
				>
					{start.isPending ? runResumeCopy.pending : runResumeCopy.action}
				</button>
				<button
					type="button"
					className={clsx(
						control.box,
						control.off,
						styles.more,
						shell.buttonFocus,
					)}
					aria-label={runResumeCopy.choices}
					title={runResumeCopy.choices}
					aria-haspopup="menu"
					aria-expanded={open}
					aria-controls={menuId}
					disabled={start.isPending}
					onClick={() => setOpen((next) => !next)}
				>
					<Caret />
				</button>
				{open ? (
					<div id={menuId} className={clsx(frame.menuList)} role="menu">
						<button
							type="button"
							role="menuitem"
							className={clsx(frame.menuItem, shell.buttonFocus)}
							onClick={() => pick("resume")}
						>
							{runResumeCopy.fromCheckpoint}
						</button>
						<button
							type="button"
							role="menuitem"
							className={clsx(frame.menuItem, shell.buttonFocus)}
							onClick={() => pick("restart")}
						>
							{runResumeCopy.fromBeginning}
						</button>
					</div>
				) : null}
			</div>
			{start.error === null ? null : (
				<p className={clsx(panel.error)}>{start.error.message}</p>
			)}
			<ConfirmDialog
				id={`run-restart-dialog-${run.id}`}
				open={asking}
				title={runResumeCopy.title}
				body={
					run.statusKind === "blocked"
						? runResumeCopy.bodyBlocked
						: runResumeCopy.body
				}
				confirmLabel={runResumeCopy.confirm}
				dismissLabel={runResumeCopy.dismiss}
				onCancel={() => setAsking(false)}
				onConfirm={() => {
					setAsking(false);
					start.mutate("restart");
				}}
			/>
		</div>
	);
}
