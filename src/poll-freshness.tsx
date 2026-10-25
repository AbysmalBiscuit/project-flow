import { type ReactNode, useEffect, useState } from "react";

import type { PollProgress } from "./domain.ts";
import { onAppEvent } from "./events.ts";
import { usePollAge } from "./poll-age.ts";
import { pageQueryClient } from "./queries.ts";
import { PollStatus, RefreshGlyph } from "./shell.tsx";
import { overviewControlLabel } from "./terms.ts";
import { headerControlStyle, shell } from "./ui-styles.ts";
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

function pollPercent(progress: PollProgress): number {
	if (progress.total === 0) {
		return 0;
	}
	return Math.round((progress.done / progress.total) * 100);
}

export function PollAgeText({ queryKey }: { queryKey: readonly unknown[] }) {
	const age = usePollAge(queryFetchedAt(queryKey));
	const progress = usePollProgress();
	if (progress !== null) {
		const percent = pollPercent(progress);
		return (
			<>
				{", "}
				<span
					id="poll-status"
					role="progressbar"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={percent}
				>
					{`${overviewControlLabel.updating} ${percent}%`}
				</span>
			</>
		);
	}
	if (age === null) {
		return null;
	}
	return (
		<>
			{", "}
			<PollStatus text={age} polling={false} />
		</>
	);
}

export function RefreshButton({
	id,
	refreshing,
	onRefresh,
}: {
	id: string;
	refreshing: boolean;
	onRefresh: () => void;
}): ReactNode {
	return (
		<button
			type="button"
			id={id}
			className={clsx(headerControlStyle.square, shell.buttonFocus)}
			aria-label={overviewControlLabel.refresh}
			aria-busy={refreshing}
			title={overviewControlLabel.refresh}
			onClick={onRefresh}
		>
			<RefreshGlyph spinning={refreshing} />
		</button>
	);
}
