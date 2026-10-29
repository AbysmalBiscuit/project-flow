import { type ReactNode, useEffect, useState } from "react";

import { control } from "./control-styles.ts";
import type { PollProgress } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { usePollAge } from "./poll-age.ts";
import { pageQueryClient } from "./queries.ts";
import { RefreshGlyph } from "./shell.tsx";
import { overviewControlLabel } from "./terms.ts";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

function queryFetchedAt(queryKey: readonly unknown[]): number {
	return pageQueryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0;
}

export function pollLine(progress: PollProgress): string {
	const count = `${progress.done} ${overviewControlLabel.pollProgress} ${progress.total}`;
	if (progress.project === null) {
		return count;
	}
	return `${count}, ${overviewControlLabel.reading} ${progress.project}`;
}

/** The progress of the running poll, or null when no poll runs. */
export function usePollProgress(): PollProgress | null {
	const [progress, setProgress] = useState<PollProgress | null>(null);
	useEffect(() => {
		return onAppEvent("progress", (event) => {
			const next = JSON.parse(event.data) as PollProgress;
			setProgress(next.ended ? null : next);
		});
	}, []);
	return progress;
}

export function postRefresh(queryKey: readonly unknown[]): void {
	void pageQueryClient.invalidateQueries({ queryKey });
	void fetch("/api/refresh", { method: "POST" });
}

export function pollPercent(progress: PollProgress): number {
	if (progress.total === 0) {
		return 0;
	}
	return Math.round((progress.done / progress.total) * 100);
}

/** How fresh the data under `queryKey` is: the running poll's progress, else its age. */
function useFreshness(queryKey: readonly unknown[]): string | null {
	const age = usePollAge(queryFetchedAt(queryKey));
	const progress = usePollProgress();
	return progress === null
		? age
		: `${overviewControlLabel.updating} ${pollPercent(progress)}%`;
}

/** The refresh button. Its hover text says how fresh the data under `queryKey` is. */
export function RefreshButton({
	id,
	queryKey,
	refreshing,
	onRefresh,
}: {
	id: string;
	queryKey: readonly unknown[];
	refreshing: boolean;
	onRefresh: () => void;
}): ReactNode {
	const freshness = useFreshness(queryKey);
	return (
		<button
			type="button"
			id={id}
			className={clsx(headerControlStyle.square, control.press, control.focus)}
			aria-label={overviewControlLabel.refresh}
			aria-description={freshness ?? undefined}
			aria-busy={refreshing}
			title={
				freshness === null
					? overviewControlLabel.refresh
					: `${overviewControlLabel.refresh}, ${freshness}`
			}
			data-freshness={freshness ?? ""}
			onClick={onRefresh}
		>
			<RefreshGlyph spinning={refreshing} />
		</button>
	);
}
