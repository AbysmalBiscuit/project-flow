import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "./button.tsx";
import { PageSizePicker, usePaged } from "./factories-paging.tsx";
import { defaultPageSize, type PageSize } from "./factories-view.ts";
import { listDetail } from "./list-detail-styles.ts";
import { PageLoading } from "./loading.tsx";
import { retroPagePath } from "./page-links.ts";
import { pageQuery } from "./queries-page.ts";
import { Card, NotServed, Source, span } from "./retros-parts.tsx";
import { FrictionGroups, RunRetroCard } from "./retros-run.tsx";
import { pickedRun, RunsTable } from "./retros-runs.tsx";
import { styles } from "./retros-styles.ts";
import { costLabel } from "./run-terms.ts";
import { Segment } from "./segment.tsx";
import { PageFrame } from "./shell.tsx";
import { useShortcut } from "./shortcuts.ts";
import { navLabel } from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { ticketLabel } from "./ticket-key.ts";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";
import { retrosCopy } from "./workflows-terms.ts";

const sum = (values: readonly number[]): number =>
	values.reduce((total, value) => total + value, 0);

const divide = (part: number, whole: number): number =>
	whole === 0 ? 0 : part / whole;

const median = (values: readonly number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const upper = sorted[middle] ?? 0;
	if (sorted.length % 2 === 1) {
		return upper;
	}
	return ((sorted[middle - 1] ?? 0) + upper) / 2;
};

export function Page() {
	const [roughOrWorse, setRoughOrWorse] = useState(false);
	const [picked, setPicked] = useState(pickedRun);
	const [query, setQuery] = useState("");
	const [cause, setCause] = useState<string | null>(null);
	const [list, setList] = useState<"runs" | "friction">("runs");
	const [size, setSize] = useState<PageSize>(defaultPageSize);
	const retros = useQuery(pageQuery.retros(roughOrWorse));
	const page = retros.data;

	const needle = query.trim().toLowerCase();
	const causeRunIds =
		cause === null
			? null
			: new Set(
					page?.friction.find((group) => group.cause === cause)?.runIds ?? [],
				);
	const runs = (page?.runs ?? []).filter(
		(run) =>
			ticketLabel(run.ticket).toLowerCase().includes(needle) &&
			(causeRunIds === null || causeRunIds.has(run.id)),
	);
	const filtered = needle !== "" || cause !== null || roughOrWorse;
	const runsList = usePaged(
		retrosCopy.runs,
		runs,
		size,
		`${query}|${cause}|${roughOrWorse}`,
	);
	const friction = usePaged(retrosCopy.friction, page?.friction ?? [], size);

	const shown = picked ?? page?.runs[0]?.id ?? null;
	const pick = (id: string) => {
		setPicked(id);
		window.history.replaceState(null, "", retroPagePath(id));
	};
	const moveBy = (step: 1 | -1) => {
		const current = runs.findIndex((run) => run.id === shown);
		const index = Math.min(Math.max(current + step, 0), runs.length - 1);
		const next = runs[index];
		if (next === undefined) {
			return;
		}
		pick(next.id);
		runsList.show(index);
		setList("runs");
	};
	useShortcut("pickNext", () => moveBy(1));
	useShortcut("pickPrevious", () => moveBy(-1));
	const filterBy = (name: string) => {
		const first = page?.friction.find((group) => group.cause === name)
			?.runIds[0];
		setCause(name);
		setList("runs");
		if (first !== undefined) {
			pick(first);
		}
	};

	const costTotal = sum(runs.map((run) => run.costUsd));
	const smoothCount = runs.filter((run) => run.smoothness === "smooth").length;
	const tiles = [
		{
			label: retrosCopy.summary.runs,
			value: String(runs.length),
			note: filtered
				? retrosCopy.summaryNote.filtered
				: retrosCopy.summaryNote.all,
		},
		{
			label: retrosCopy.summary.smooth,
			value: `${Math.round(divide(smoothCount, runs.length) * 100)}%`,
			note: retrosCopy.summaryNote.smooth(smoothCount, runs.length),
		},
		{
			label: retrosCopy.summary.median,
			value: span(median(runs.map((run) => run.durationS))),
			note: retrosCopy.summaryNote.median,
		},
		{
			label: retrosCopy.summary.lost,
			value: span(sum(runs.map((run) => run.timeLostS))),
			note: retrosCopy.summaryNote.lost,
		},
		{
			label: retrosCopy.summary.cost,
			value: costLabel(costTotal),
			note: retrosCopy.summaryNote.cost(
				costLabel(divide(costTotal, runs.length)),
			),
		},
	];
	const emptyRuns =
		needle !== "" || cause !== null
			? retrosCopy.noMatch
			: roughOrWorse
				? retrosCopy.noRough
				: retrosCopy.noRuns;

	return (
		<PageFrame title={navLabel.retros} subtitle={retrosCopy.subtitle}>
			{page === undefined ? (
				<PageLoading />
			) : (
				<>
					<div className={clsx(styles.grid, styles.tiles)}>
						{tiles.map(({ label, value, note }) => (
							<div key={label}>
								<div className={clsx(styles.kicker)}>{label}</div>
								<div className={clsx(styles.tileValue)}>{value}</div>
								<p className={clsx(styles.note)}>{note}</p>
							</div>
						))}
					</div>
					<div className={clsx(listDetail.split)}>
						<Card
							title={
								<span className={clsx(headerControlStyle.group)}>
									<Segment
										label={retrosCopy.runs}
										on={list === "runs"}
										onClick={() => setList("runs")}
									/>
									<Segment
										label={retrosCopy.friction}
										on={list === "friction"}
										onClick={() => setList("friction")}
									/>
								</span>
							}
							head={
								<>
									<PageSizePicker
										id="retros-list"
										title={
											list === "runs" ? retrosCopy.runs : retrosCopy.friction
										}
										size={size}
										onChange={setSize}
									/>
									{list === "runs" ? (
										<Source>{retrosCopy.sources.route}</Source>
									) : (
										<Source store>{retrosCopy.sources.aggregate}</Source>
									)}
								</>
							}
						>
							{list === "runs" ? (
								<>
									<div className={clsx(styles.head)}>
										<TextInput
											type="search"
											icon="search"
											aria-label={retrosCopy.searchTicket}
											placeholder={retrosCopy.searchTicket}
											value={query}
											onChange={(event) => setQuery(event.target.value)}
										/>
										<span className={clsx(headerControlStyle.group)}>
											<Segment
												label={retrosCopy.all}
												on={!roughOrWorse}
												onClick={() => setRoughOrWorse(false)}
											/>
											<Segment
												label={retrosCopy.roughOrWorse}
												on={roughOrWorse}
												onClick={() => setRoughOrWorse(true)}
											/>
										</span>
									</div>
									{cause === null ? null : (
										<div className={clsx(styles.head)}>
											<p className={clsx(styles.empty)}>
												{retrosCopy.hitBy(cause)}
											</p>
											<Button
												label={retrosCopy.clearFilter}
												onClick={() => setCause(null)}
											/>
										</div>
									)}
									<RunsTable
										runs={runsList.rows}
										blank={runsList.blank}
										picked={shown}
										onPick={pick}
										empty={emptyRuns}
									/>
									{runsList.pager}
									<NotServed page={page} />
								</>
							) : (
								<>
									<p className={clsx(styles.note)}>{retrosCopy.frictionHint}</p>
									<FrictionGroups
										groups={friction.rows}
										blank={friction.blank}
										runs={page.runs}
										picked={shown}
										onPick={pick}
										onFilter={filterBy}
									/>
									{friction.pager}
								</>
							)}
						</Card>
						<div className={clsx(listDetail.sticky)}>
							{shown === null ? (
								<p className={clsx(styles.empty)}>{retrosCopy.pickRun}</p>
							) : (
								<RunRetroCard
									runId={shown}
									outside={!runs.some((run) => run.id === shown)}
								/>
							)}
						</div>
					</div>
				</>
			)}
		</PageFrame>
	);
}
