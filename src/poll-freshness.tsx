import type { ReactNode } from "react";
import { usePollAge } from "./poll-age.ts";
import { pageQueryClient } from "./queries.ts";
import { PollStatus, RefreshGlyph } from "./shell.tsx";
import { overviewControlLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { headerControlStyle, shell } from "./ui-styles.ts";

function queryFetchedAt(queryKey: readonly unknown[]): number {
	const data = pageQueryClient.getQueryData(queryKey) as
		| { fetchedAt?: string | null }
		| undefined;
	const fetchedAt = Date.parse(data?.fetchedAt ?? "");
	if (!Number.isNaN(fetchedAt) && fetchedAt > 0) {
		return fetchedAt;
	}
	return pageQueryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0;
}

export function postRefresh(queryKey: readonly unknown[]): void {
	void pageQueryClient.invalidateQueries({ queryKey });
	void fetch("/api/refresh", { method: "POST" });
}

export function PollAgeText({
	queryKey,
	refreshing,
}: {
	queryKey: readonly unknown[];
	refreshing: boolean;
}) {
	const age = usePollAge(queryFetchedAt(queryKey));
	if (!refreshing && age === null) {
		return null;
	}
	return (
		<>
			{", "}
			<PollStatus text={refreshing ? null : age} polling={refreshing} />
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
