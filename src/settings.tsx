import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Configuration, ProjectPin } from "./configuration.ts";
import type { SettingsProject } from "./domain.ts";
import { projectHasPmBot } from "./domain.ts";
import type { KnownBot } from "./known-bots.ts";
import { knownBots } from "./known-bots.ts";
import { repoKey, samePin } from "./project-ref.ts";
import { pageQuery, useSaveSettings } from "./queries.ts";
import {
	FilterGlyph,
	laneStates,
	SearchGlyph,
	Switch,
	sections,
	type stateFilters,
	type Trackers,
	type trackerFilters,
} from "./settings-parts.tsx";
import {
	ContentsNav,
	GeneralSection,
	NotificationsSection,
	ProjectViewsSection,
	patchStar,
	ReviewSection,
	SettingsBar,
	SettingsToast,
	TrackersSection,
} from "./settings-sections.tsx";
import { settings as fields, settingsBots } from "./settings-styles.ts";
import { PageFrame, PollStatus } from "./shell.tsx";
import {
	loadingLabel,
	navLabel,
	settingsCopy,
	settingsSection,
	stateLabel,
} from "./terms.ts";
import { pageTheme, watchPageTheme } from "./theme.ts";
import { clsx } from "./ui.ts";
import { viewDefaults } from "./view-settings.ts";

const toastHideMs = 4_000;

function draftOf(settings: Configuration): Configuration {
	return {
		...settings,
		projectViews: {
			...settings.projectViews,
			"*": { ...viewDefaults(), ...settings.projectViews["*"] },
		},
	};
}

function same(left: Configuration, right: Configuration): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function mergeLoaded(
	current: Configuration,
	previous: Configuration,
	loaded: Configuration,
): Configuration {
	const next = { ...current };
	const assign = <K extends keyof Configuration>(key: K): void => {
		if (sameValue(current[key], previous[key])) {
			next[key] = loaded[key];
		}
	};
	for (const key of Object.keys(loaded) as (keyof Configuration)[]) {
		assign(key);
	}
	const star = current.projectViews["*"];
	const previousStar = previous.projectViews["*"];
	const loadedStar = loaded.projectViews["*"];
	if (
		star !== undefined &&
		previousStar !== undefined &&
		loadedStar !== undefined
	) {
		const merged = { ...star };
		const assignStar = <K extends keyof typeof loadedStar>(key: K): void => {
			if (sameValue(star[key], previousStar[key])) {
				merged[key] = loadedStar[key];
			}
		};
		for (const key of Object.keys(loadedStar) as (keyof typeof loadedStar)[]) {
			assignStar(key);
		}
		next.projectViews = { ...loaded.projectViews, "*": merged };
	}
	return next;
}

function sameValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function Menu({
	loaded,
	trackers,
	projects,
	polling,
	onSave,
}: {
	loaded: Configuration;
	trackers: Trackers;
	projects: SettingsProject[];
	polling: boolean;
	onSave: (
		next: Configuration,
		baseline: Configuration,
	) => Promise<string | null>;
}) {
	const [saved, setSaved] = useState(draftOf(loaded));
	const [draft, setDraft] = useState(draftOf(loaded));
	const baseline = useRef(saved);
	const [current, setCurrent] = useState<string>(sections[0].id);
	const [message, setMessage] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const [toast, setToast] = useState(0);
	const [permission, setPermission] = useState("default");
	const dirty = !same(draft, saved);
	const view = draft.projectViews["*"] ?? viewDefaults();
	const [theme, setTheme] = useState(pageTheme);
	useEffect(() => {
		setTheme(pageTheme());
		return watchPageTheme(setTheme);
	}, []);

	useEffect(() => {
		const previous = baseline.current;
		const next = mergeLoaded(previous, previous, loaded);
		baseline.current = next;
		setSaved(next);
		setDraft((current) => mergeLoaded(current, previous, loaded));
	}, [loaded]);

	useEffect(() => {
		const notify = navigator.permissions?.query({
			name: "notifications",
		});
		if (notify === undefined) {
			return;
		}
		let stopped = false;
		void notify.then((status) => {
			if (!stopped) {
				setPermission(status.state);
			}
		});
		return () => {
			stopped = true;
		};
	}, []);

	useEffect(() => {
		if (toast === 0 || failed || message === null) {
			return;
		}
		const hide = window.setTimeout(() => {
			setMessage(null);
			setToast(0);
		}, toastHideMs);
		return () => {
			window.clearTimeout(hide);
		};
	}, [toast, failed, message]);

	function patch(next: Partial<Configuration>): void {
		setDraft((currentDraft) => ({ ...currentDraft, ...next }));
		setMessage(null);
		setFailed(false);
		setToast(0);
	}

	const shown = new Set(
		view.shownLanes ?? laneStates.map((state) => stateLabel[state]),
	);

	return (
		<PageFrame
			title={navLabel.settings}
			subtitle={<PollStatus text={null} polling={polling} />}
			scroll
		>
			<p id="settings-lead" className={clsx(fields.lead)}>
				{settingsCopy.savedTo}
			</p>
			<div className={clsx(fields.layout)}>
				<ContentsNav current={current} onSelect={setCurrent} />
				<div>
					<GeneralSection theme={theme} draft={draft} onChange={patch} />
					<ProjectViewsSection
						view={view}
						shown={shown}
						onPatchView={(next) => patchStar(draft, view, patch, next)}
					/>
					<ProjectsTable projects={projects} draft={draft} onChange={patch} />
					<ReviewSection draft={draft} onChange={patch} />
					<NotificationsSection
						draft={draft}
						permission={permission}
						onChange={patch}
					/>
					<TrackersSection trackers={trackers} />
					<SettingsBar
						dirty={dirty}
						onDiscard={() => {
							setDraft(saved);
							setFailed(false);
							setMessage(null);
							setToast(0);
						}}
						onSave={() => {
							void onSaveClick();
						}}
					/>
				</div>
			</div>
			<SettingsToast message={message} failed={failed} />
		</PageFrame>
	);

	async function onSaveClick(): Promise<void> {
		const error = await onSave(draft, saved);
		setFailed(error !== null);
		setMessage(error ?? settingsCopy.savedToast);
		setToast((shown) => shown + 1);
		if (error === null) {
			baseline.current = draft;
			setSaved(draft);
		}
	}
}

function withoutRef(refs: ProjectPin[], ref: ProjectPin): ProjectPin[] {
	return refs.filter((item) => !samePin(item, ref));
}

function withRef(refs: ProjectPin[], ref: ProjectPin): ProjectPin[] {
	return refs.some((item) => samePin(item, ref)) ? refs : [...refs, ref];
}

function botsOf(
	draft: Configuration,
	project: SettingsProject,
	repo: string,
): KnownBot[] {
	const saved = repoKey(draft.expectedBots ?? {}, repo);
	if (saved !== undefined) {
		return draft.expectedBots?.[saved] ?? [];
	}
	return project.repoBots[repo] ?? [];
}

function setBots(
	draft: Configuration,
	project: SettingsProject,
	repo: string,
	bots: KnownBot[],
): Configuration["expectedBots"] {
	const saved = draft.expectedBots ?? {};
	const savedKey = repoKey(saved, repo);
	const seeded =
		savedKey === undefined
			? Object.fromEntries(
					project.repos
						.filter((name) => repoKey(saved, name) === undefined)
						.map((name) => [name, project.repoBots[name] ?? []]),
				)
			: {};
	return { ...saved, ...seeded, [savedKey ?? repo]: bots };
}

function setPmBot(
	draft: Configuration,
	key: string,
	tracker: SettingsProject["tracker"],
	on: boolean,
): Configuration["pmBot"] {
	const next = { ...draft.pmBot };
	const match = Object.keys(next).find(
		(name) => name.toLowerCase() === key.toLowerCase(),
	);
	if (match !== undefined) {
		delete next[match];
	}
	const implied = tracker === "github";
	if (on !== implied) {
		next[key] = on;
	}
	return next;
}

function projectMatches(
	project: SettingsProject,
	query: string,
	tracker: (typeof trackerFilters)[number],
	state: (typeof stateFilters)[number],
	draft: Configuration,
): boolean {
	if (tracker !== "all" && project.tracker !== tracker) {
		return false;
	}
	if (
		state === "tracked" &&
		!draft.tracked.some((ref) => samePin(ref, project.ref))
	) {
		return false;
	}
	const needle = query.trim().toLowerCase();
	if (needle === "") {
		return true;
	}
	return (
		project.name.toLowerCase().includes(needle) ||
		project.key.toLowerCase().includes(needle)
	);
}

function ProjectsTable({
	projects,
	draft,
	onChange,
}: {
	projects: SettingsProject[];
	draft: Configuration;
	onChange: (next: Partial<Configuration>) => void;
}) {
	const [query, setQuery] = useState("");
	const [tracker, setTracker] =
		useState<(typeof trackerFilters)[number]>("all");
	const [state, setState] = useState<(typeof stateFilters)[number]>("all");
	const [filtersOpen, setFiltersOpen] = useState(false);
	useEffect(() => {
		if (!filtersOpen) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) {
				return;
			}
			event.preventDefault();
			setFiltersOpen(false);
			document.getElementById("project-filter")?.focus();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [filtersOpen]);

	const shown = projects.filter((project) =>
		projectMatches(project, query, tracker, state, draft),
	);

	return (
		<section id="projects" className={clsx(fields.card)}>
			<h2 className={clsx(fields.cardTitle)}>{settingsSection.projects}</h2>
			<p className={clsx(fields.projectsLead)}>{settingsCopy.projectsLead}</p>
			<div className={clsx(fields.toolbar)}>
				<label className={clsx(fields.projectSearch)} htmlFor="project-search">
					<SearchGlyph />
					<input
						id="project-search"
						className={clsx(fields.projectQuery)}
						type="search"
						aria-label={settingsCopy.searchProjects}
						placeholder={settingsCopy.searchProjects}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</label>
				<button
					id="project-filter"
					type="button"
					className={clsx(fields.filterButton)}
					aria-label={settingsCopy.filter}
					aria-expanded={filtersOpen}
					aria-controls="project-filters"
					onClick={() => setFiltersOpen((open) => !open)}
				>
					<FilterGlyph />
					{settingsCopy.filter}
				</button>
				<span id="project-count" className={clsx(fields.count)}>
					{shown.length} {settingsCopy.of} {projects.length}{" "}
					{settingsCopy.projects}
				</span>
			</div>
			{filtersOpen ? (
				<div id="project-filters" className={clsx(fields.filterPanel)}>
					<div id="tracker-filter" className={clsx(fields.filterLabel)}>
						<span>{settingsCopy.tracker}</span>
						{(
							[
								["all", settingsCopy.all],
								["github", settingsCopy.github],
								["linear", settingsCopy.linear],
							] as const
						).map(([value, label]) => (
							<button
								key={value}
								id={`tracker-${value}`}
								type="button"
								aria-pressed={tracker === value}
								className={clsx(
									fields.filterChoice,
									tracker === value && fields.filterOn,
								)}
								onClick={() => setTracker(value)}
							>
								{label}
							</button>
						))}
					</div>
					<div id="state-filter" className={clsx(fields.filterLabel)}>
						<span>{settingsCopy.state}</span>
						{(
							[
								["all", settingsCopy.all],
								["tracked", settingsCopy.tracked],
							] as const
						).map(([value, label]) => (
							<button
								key={value}
								id={`state-${value}`}
								type="button"
								aria-pressed={state === value}
								className={clsx(
									fields.filterChoice,
									state === value && fields.filterOn,
								)}
								onClick={() => setState(value)}
							>
								{label}
							</button>
						))}
					</div>
				</div>
			) : null}
			<table className={clsx(fields.table)}>
				<thead className={clsx(fields.head)}>
					<tr>
						<th className={clsx(fields.headCell)}>{settingsCopy.project}</th>
						<th className={clsx(fields.headSwitch)}>{settingsCopy.tracked}</th>
						<th className={clsx(fields.headSwitch)}>{settingsCopy.pmBot}</th>
						<th className={clsx(fields.headCell)}>
							{settingsCopy.expectedBots}
						</th>
					</tr>
				</thead>
				<tbody>
					{shown.map((project) => (
						<ProjectRow
							key={`${project.tracker}:${project.key}`}
							project={project}
							draft={draft}
							onChange={onChange}
						/>
					))}
				</tbody>
			</table>
		</section>
	);
}

function ProjectRow({
	project,
	draft,
	onChange,
}: {
	project: SettingsProject;
	draft: Configuration;
	onChange: (next: Partial<Configuration>) => void;
}) {
	const id = `${project.tracker}-${project.key.replace(/[^A-Za-z0-9]+/g, "-")}`;
	const repos = project.repos;
	const pmBot = projectHasPmBot(draft.pmBot, project.key, project.tracker);
	const tracked = draft.tracked.some((ref) => samePin(ref, project.ref));
	return (
		<tr id={`project-row-${id}`}>
			<td className={clsx(fields.cell)}>
				<div className={clsx(fields.projectName)}>{project.name}</div>
				<div className={clsx(fields.projectMeta)}>
					{project.tracker === "github"
						? settingsCopy.github
						: settingsCopy.linear}
					{", "}
					{project.key}
				</div>
			</td>
			<td className={clsx(fields.switchCell)}>
				<Switch
					id={`track-${id}`}
					checked={tracked}
					label={`${settingsCopy.tracked} ${project.name}`}
					onChange={(next) =>
						onChange({
							tracked: next
								? withRef(draft.tracked, project.ref)
								: withoutRef(draft.tracked, project.ref),
						})
					}
				/>
			</td>
			<td className={clsx(fields.switchCell)}>
				<Switch
					id={`pm-bot-${id}`}
					checked={pmBot}
					label={`${settingsCopy.pmBot} ${project.name}`}
					onChange={(next) =>
						onChange({
							pmBot: setPmBot(draft, project.key, project.tracker, next),
						})
					}
				/>
			</td>
			<td className={clsx(fields.cell)}>
				{repos.length === 0 ? (
					<span id={`bots-unavailable-${id}`}>
						{settingsCopy.botsUnavailable}
					</span>
				) : (
					repos.map((repo) => {
						const bots = botsOf(draft, project, repo);
						const missing = knownBots.filter((bot) => !bots.includes(bot));
						const repoId = repo.replace(/[^A-Za-z0-9]+/g, "-");
						return (
							<div key={repo} className={clsx(settingsBots.bots)}>
								<span className={clsx(fields.projectMeta)}>{repo}</span>
								{bots.map((bot) => (
									<span key={bot} className={clsx(fields.chip)}>
										{bot}
										<button
											type="button"
											className={clsx(fields.chipRemove)}
											aria-label={`Remove ${bot} ${repo}`}
											onClick={() =>
												onChange({
													expectedBots: setBots(
														draft,
														project,
														repo,
														bots.filter((item) => item !== bot),
													),
												})
											}
										>
											×
										</button>
									</span>
								))}
								{missing.length === 0 ? null : (
									<select
										id={`add-bot-${id}-${repoId}`}
										className={clsx(settingsBots.addBot)}
										aria-label={`${settingsCopy.addBot} ${repo}`}
										value=""
										onChange={(event) => {
											const bot = knownBots.find(
												(item) => item === event.target.value,
											);
											if (bot === undefined) {
												return;
											}
											onChange({
												expectedBots: setBots(draft, project, repo, [
													...bots,
													bot,
												]),
											});
										}}
									>
										<option value="">{settingsCopy.addBot}</option>
										{missing.map((bot) => (
											<option key={bot} value={bot}>
												{bot}
											</option>
										))}
									</select>
								)}
							</div>
						);
					})
				)}
			</td>
		</tr>
	);
}

export function Page() {
	const page = useQuery(pageQuery.settingsPage);
	const overview = useQuery(pageQuery.overview);
	const save = useSaveSettings();
	const loaded = page.data;
	const polling =
		overview.data?.polling === true ||
		(overview.data === undefined && !page.isFetched);
	if (page.isError && loaded === undefined) {
		const cause = page.error;
		return (
			<PageFrame title={navLabel.settings}>
				{cause instanceof Error ? cause.message : "Settings unavailable"}
			</PageFrame>
		);
	}
	if (loaded === undefined) {
		return <PageFrame title={navLabel.settings}>{loadingLabel}</PageFrame>;
	}
	return (
		<Menu
			loaded={loaded.settings}
			trackers={loaded.trackers}
			projects={loaded.projects}
			polling={polling}
			onSave={async (next, baseline) => {
				const current = await page.refetch();
				if (current.isError || current.error !== null) {
					return current.error instanceof Error
						? current.error.message
						: "Settings unavailable";
				}
				if (current.data === undefined) {
					return "Settings unavailable";
				}
				try {
					await save.mutateAsync((live) => {
						const star = next.projectViews["*"] ?? live.projectViews["*"];
						return {
							...live,
							...next,
							theme: live.theme,
							overview: live.overview,
							tracked: next.tracked,
							baselineTracked: baseline.tracked,
							pmBot: next.pmBot,
							expectedBots: next.expectedBots,
							projectViews: {
								...live.projectViews,
								...(star === undefined ? {} : { "*": star }),
							},
						};
					});
				} catch (cause) {
					return cause instanceof Error ? cause.message : "save failed";
				}
				return null;
			}}
		/>
	);
}
