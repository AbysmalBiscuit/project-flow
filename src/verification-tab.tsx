import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PageSizePicker, usePaged } from "./factories-paging.tsx";
import { defaultPageSize, type PageSize } from "./factories-view.ts";
import { listDetail } from "./list-detail-styles.ts";
import { PageLoading } from "./loading.tsx";
import { pageQuery } from "./queries-page.ts";
import { Segment } from "./segment.tsx";
import { PageFrame } from "./shell.tsx";
import { useShortcut } from "./shortcuts.ts";
import { navLabel } from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { ticketLabel } from "./ticket-key.ts";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";
import { Card, Sources } from "./verification-card.tsx";
import {
	ChecksTable,
	NotServed,
	Reasons,
	RunsList,
} from "./verification-checks.tsx";
import { PickedRun } from "./verification-run.tsx";
import { styles } from "./verification-styles.ts";
import { Tiles } from "./verification-tiles.tsx";
import { verificationCopy } from "./workflows-terms.ts";

type VerificationList = "checks" | "reasons";

const pickedRun = (): string | null =>
	new URLSearchParams(window.location.search).get("run");

const hasText = (text: string | null, needle: string): boolean =>
	text?.toLowerCase().includes(needle) ?? false;

export function Page() {
	const load = useQuery(pageQuery.verification);
	const [picked, setPicked] = useState(pickedRun);
	const [list, setList] = useState<VerificationList>("checks");
	const [query, setQuery] = useState("");
	const [failingOnly, setFailingOnly] = useState(false);
	const [size, setSize] = useState<PageSize>(defaultPageSize);
	const [runQuery, setRunQuery] = useState("");
	const page = load.data;
	const needle = query.trim().toLowerCase();
	const runNeedle = runQuery.trim().toLowerCase();

	const checks = (page?.checks ?? [])
		.filter(
			(check) =>
				(hasText(check.name, needle) || hasText(check.topFailure, needle)) &&
				(!failingOnly || check.passed < check.total),
		)
		.sort((a, b) => a.passed / a.total - b.passed / b.total);
	const reasons = (page?.reasons ?? []).filter((row) =>
		hasText(row.reason, needle),
	);
	const runs = (page?.runs ?? []).filter(
		(run) =>
			runNeedle === "" ||
			(run.ticket !== null && hasText(ticketLabel(run.ticket), runNeedle)),
	);

	const checkList = usePaged(
		verificationCopy.checks,
		checks,
		size,
		`${query}|${failingOnly}`,
	);
	const reasonList = usePaged(verificationCopy.reasons, reasons, size, query);
	const runList = usePaged(verificationCopy.runs, runs, size, runQuery);

	const runId = picked ?? page?.runs[0]?.id ?? null;
	const pick = (id: string) => {
		const url = new URL(window.location.href);
		url.searchParams.set("run", id);
		window.history.replaceState(null, "", url);
		setPicked(id);
	};
	const movePick = (step: 1 | -1) => {
		const index = runs.findIndex((run) => run.id === runId);
		const at = index === -1 ? 0 : index + step;
		const target = runs[at];
		if (target === undefined) {
			return;
		}
		pick(target.id);
		runList.show(at);
	};
	useShortcut("pickPrevious", () => movePick(-1));
	useShortcut("pickNext", () => movePick(1));

	const listTitle =
		list === "checks" ? verificationCopy.checks : verificationCopy.reasons;
	const filtering = needle !== "" || failingOnly;

	return (
		<PageFrame
			title={navLabel.verification}
			subtitle={verificationCopy.subtitle}
		>
			{page === undefined ? (
				<PageLoading />
			) : (
				<>
					<Tiles tiles={page.tiles} />
					<Card
						title={
							<span className={clsx(headerControlStyle.group)}>
								<Segment
									label={verificationCopy.checks}
									on={list === "checks"}
									onClick={() => setList("checks")}
								/>
								<Segment
									label={verificationCopy.reasons}
									on={list === "reasons"}
									onClick={() => setList("reasons")}
								/>
							</span>
						}
						head={
							<>
								<PageSizePicker
									id="verification-list"
									title={listTitle}
									size={size}
									onChange={setSize}
								/>
								{list === "checks" ? (
									<Sources
										route={verificationCopy.sources.route}
										store={verificationCopy.sources.aggregate}
									/>
								) : (
									<Sources store={verificationCopy.sources.store} />
								)}
							</>
						}
					>
						<div className={clsx(styles.head)}>
							<TextInput
								type="search"
								icon="search"
								aria-label={
									list === "checks"
										? verificationCopy.searchCheck
										: verificationCopy.searchReason
								}
								placeholder={
									list === "checks"
										? verificationCopy.searchCheck
										: verificationCopy.searchReason
								}
								value={query}
								onChange={(event) => setQuery(event.target.value)}
							/>
							{list === "checks" ? (
								<span className={clsx(headerControlStyle.group)}>
									<Segment
										label={verificationCopy.failingOnly}
										on={failingOnly}
										onClick={() => setFailingOnly(!failingOnly)}
									/>
								</span>
							) : null}
						</div>
						{list === "checks" ? (
							<>
								<ChecksTable
									checks={checkList.rows}
									blank={checkList.blank}
									empty={
										filtering
											? verificationCopy.noCheckMatch
											: verificationCopy.noChecks
									}
								/>
								{checkList.pager}
								<NotServed factories={page.notServed} />
							</>
						) : (
							<>
								<Reasons
									reasons={reasonList.rows}
									blank={reasonList.blank}
									empty={
										needle === ""
											? verificationCopy.noReasons
											: verificationCopy.noReasonMatch
									}
								/>
								{reasonList.pager}
							</>
						)}
					</Card>
					<div className={clsx(listDetail.split, listDetail.belowCard)}>
						<Card title={verificationCopy.runs} head={null}>
							<div className={clsx(styles.head)}>
								<TextInput
									type="search"
									icon="search"
									aria-label={verificationCopy.searchTicket}
									placeholder={verificationCopy.searchTicket}
									value={runQuery}
									onChange={(event) => setRunQuery(event.target.value)}
								/>
							</div>
							<RunsList
								runs={runList.rows}
								blank={runList.blank}
								picked={runId}
								onPick={pick}
							/>
							{runList.pager}
						</Card>
						<div className={clsx(listDetail.sticky)}>
							{runId === null ? (
								<Card
									title={verificationCopy.run}
									head={<Sources route={verificationCopy.sources.route} />}
								>
									<p className={clsx(styles.empty)}>
										{verificationCopy.noRuns}
									</p>
									<NotServed factories={page.notServed} />
								</Card>
							) : (
								<PickedRun runId={runId} />
							)}
						</div>
					</div>
				</>
			)}
		</PageFrame>
	);
}
