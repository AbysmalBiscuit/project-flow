import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Button } from "./button.tsx";
import { Dropdown } from "./dropdown.tsx";
import { PageSizePicker, usePaged } from "./factories-paging.tsx";
import { defaultPageSize, type PageSize } from "./factories-view.ts";
import { listDetail } from "./list-detail-styles.ts";
import { pageQuery } from "./queries-page.ts";
import { Segment } from "./segment.tsx";
import { PageFrame } from "./shell.tsx";
import { useShortcut } from "./shortcuts.ts";
import { navLabel } from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";
import { useNow } from "./use-now.ts";
import { versionKey } from "./workflows-cards.tsx";
import { Detail } from "./workflows-detail.tsx";
import { styles } from "./workflows-styles.ts";
import { VersionsTable } from "./workflows-table.tsx";
import { workflowsCopy } from "./workflows-terms.ts";

const runsKeys = ["any", "with", "none"] as const;
type RunsFilter = (typeof runsKeys)[number];

const runsChoices = runsKeys.map((id) => ({
	id,
	label: workflowsCopy.runsFilter[id],
}));

const runsOf = (id: string): RunsFilter =>
	runsKeys.find((key) => key === id) ?? "any";

const flashMs = 1200;

export function Page() {
	const page = useQuery(pageQuery.workflows).data;
	const cards = page?.cards;
	const all = cards ?? [];
	const now = useNow(60_000);
	const [picked, setPicked] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [pkg, setPkg] = useState("all");
	const [runs, setRuns] = useState<RunsFilter>("any");
	const [latestOnly, setLatestOnly] = useState(false);
	const [size, setSize] = useState<PageSize>(defaultPageSize);
	const [flash, setFlash] = useState(false);
	const detailRef = useRef<HTMLDivElement>(null);

	const latest = new Set<string>();
	const seenPackages = new Set<string>();
	for (const item of all) {
		if (!seenPackages.has(item.package)) {
			seenPackages.add(item.package);
			latest.add(versionKey(item));
		}
	}

	const needle = query.trim().toLowerCase();
	const rows = all.filter(
		(item) =>
			(item.package.toLowerCase().includes(needle) ||
				(item.sha ?? "").toLowerCase().includes(needle)) &&
			(pkg === "all" || item.package === pkg) &&
			(runs === "any" || (runs === "with" ? item.runs > 0 : item.runs === 0)) &&
			(!latestOnly || latest.has(versionKey(item))),
	);
	const paged = usePaged(
		workflowsCopy.versions,
		rows,
		size,
		`${query}|${pkg}|${runs}|${latestOnly}`,
	);

	const packageChoices = [
		{ id: "all", label: workflowsCopy.allPackages },
		...[...seenPackages].map((name) => ({ id: name, label: name })),
	];
	const filtered =
		query !== "" || pkg !== "all" || runs !== "any" || latestOnly;
	const clearFilters = () => {
		setQuery("");
		setPkg("all");
		setRuns("any");
		setLatestOnly(false);
	};

	const card = all.find((item) => versionKey(item) === picked);
	const pick = (key: string) => setPicked(key);
	const close = () => {
		if (picked === null) {
			return;
		}
		setPicked(null);
		document
			.querySelector(`[data-key="${CSS.escape(picked)}"]`)
			?.scrollIntoView({ block: "center" });
	};
	useShortcut("closeDetail", close, picked !== null);

	useEffect(() => {
		if (picked === null) {
			return;
		}
		detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
		setFlash(true);
		const timer = setTimeout(() => setFlash(false), flashMs);
		return () => clearTimeout(timer);
	}, [picked]);

	return (
		<PageFrame title={navLabel.workflows} subtitle={workflowsCopy.subtitle}>
			{cards === undefined ? null : cards.length === 0 ? (
				<p className={clsx(styles.empty)}>{workflowsCopy.empty}</p>
			) : (
				<>
					<div className={clsx(styles.card)}>
						<div className={clsx(styles.head)}>
							<h2 className={clsx(styles.heading)}>{workflowsCopy.versions}</h2>
							<PageSizePicker
								id="workflows-list"
								title={workflowsCopy.versions}
								size={size}
								onChange={setSize}
							/>
						</div>
						<div className={clsx(styles.head)}>
							<TextInput
								id="workflows-query"
								type="search"
								icon="search"
								aria-label={workflowsCopy.search}
								placeholder={workflowsCopy.search}
								value={query}
								onChange={(event) => setQuery(event.target.value)}
							/>
							<Dropdown
								id="workflows-package"
								label={workflowsCopy.allPackages}
								value={pkg}
								choices={packageChoices}
								onChange={setPkg}
							/>
							<Dropdown
								id="workflows-runs"
								label={workflowsCopy.runsFilter.any}
								value={runs}
								choices={runsChoices}
								onChange={(id) => setRuns(runsOf(id))}
							/>
							<span className={clsx(headerControlStyle.group)}>
								<Segment
									id="workflows-latest"
									label={workflowsCopy.latestOnly}
									on={latestOnly}
									onClick={() => setLatestOnly(!latestOnly)}
								/>
							</span>
							{filtered ? (
								<Button
									label={workflowsCopy.clearFilters}
									tone="quiet"
									onClick={clearFilters}
								/>
							) : null}
						</div>
						<VersionsTable
							rows={paged.rows}
							blank={paged.blank}
							latest={latest}
							picked={picked}
							reading={page?.reading ?? false}
							now={now}
							onPick={pick}
						/>
						{paged.pager}
					</div>
					{card === undefined ? null : (
						<div
							ref={detailRef}
							className={clsx(listDetail.belowCard, flash && styles.flash)}
						>
							<Detail card={card} onClose={close} />
						</div>
					)}
				</>
			)}
		</PageFrame>
	);
}
