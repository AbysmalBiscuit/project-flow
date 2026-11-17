import { useState } from "react";

import { useTrackerLabel } from "./backend-labels.ts";
import { Button } from "./button.tsx";
import { Chip } from "./chip.tsx";
import type { Configuration, ProjectPin } from "./configuration.ts";
import type { BackendViews, SettingsProject, TrackerKind } from "./domain.ts";
import type { KnownBot } from "./known-bots.ts";
import { knownBots } from "./known-bots.ts";
import { withoutPins, withPin } from "./project-pins.ts";
import { samePin } from "./project-ref.ts";
import { repoKey } from "./repo-key.ts";
import { Segment } from "./segment.tsx";
import { Select } from "./select.tsx";
import { SettingsDialog } from "./settings-dialog.tsx";
import { StateMappingDialog } from "./settings-mapping.tsx";
import { type stateFilters, Switch } from "./settings-parts.tsx";
import { settings as fields, settingsBots } from "./settings-styles.ts";
import { settingsCopy, settingsSection } from "./settings-terms.ts";
import type { StateSource } from "./settings-write.ts";
import { TextInput } from "./text-input.tsx";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

function isTracked(pins: ProjectPin[], project: SettingsProject): boolean {
	const named = [project.ref, ...project.savedPins];
	return pins.some((pin) => named.some((item) => samePin(item, pin)));
}

/** The pin of a tracked project in the form that the overview reads, so a pin matches its tracked entry. */
function pinOf(draft: Configuration, project: SettingsProject): ProjectPin {
	const named = [project.ref, ...project.savedPins];
	return (
		draft.tracked.find((pin) => named.some((item) => samePin(item, pin))) ??
		project.ref
	);
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

function pmBotOf(draft: Configuration, project: SettingsProject): boolean {
	const saved = repoKey(draft.pmBot, project.key);
	return saved === undefined
		? project.pmBotDefault
		: (draft.pmBot[saved] ?? project.pmBotDefault);
}

function setPmBot(
	draft: Configuration,
	project: SettingsProject,
	on: boolean,
): Configuration["pmBot"] {
	const next = { ...draft.pmBot };
	const saved = repoKey(next, project.key);
	if (saved !== undefined) {
		delete next[saved];
	}
	if (on !== project.pmBotDefault) {
		next[project.key] = on;
	}
	return next;
}

type TrackerFilter = "all" | TrackerKind;

function projectMatches(
	project: SettingsProject,
	query: string,
	tracker: TrackerFilter,
	state: (typeof stateFilters)[number],
	draft: Configuration,
): boolean {
	if (tracker !== "all" && project.tracker !== tracker) {
		return false;
	}
	if (state === "tracked" && !isTracked(draft.tracked, project)) {
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

export function ProjectsTable({
	projects,
	trackers,
	sources,
	draft,
	onChange,
}: {
	projects: SettingsProject[];
	trackers: BackendViews["trackers"];
	sources: readonly StateSource[];
	draft: Configuration;
	onChange: (next: Partial<Configuration>) => void;
}) {
	const filters: { kind: TrackerFilter; label: string }[] = [
		{ kind: "all", label: settingsCopy.all },
		...trackers,
	];
	const [mapping, setMapping] = useState<SettingsProject | null>(null);
	const [reviewing, setReviewing] = useState<SettingsProject | null>(null);
	const mappingSource = sources.find(
		(source) => source.key === mapping?.stateSource,
	);
	const [query, setQuery] = useState("");
	const [tracker, setTracker] = useState<TrackerFilter>("all");
	const trackedCount = projects.filter((project) =>
		isTracked(draft.tracked, project),
	).length;
	const [state, setState] = useState<(typeof stateFilters)[number]>(() =>
		trackedCount === 0 ? "all" : "tracked",
	);

	const shown = projects.filter((project) =>
		projectMatches(project, query, tracker, state, draft),
	);

	return (
		<section id="projects" className={clsx(fields.card)}>
			<h2 className={clsx(fields.cardTitle)}>{settingsSection.projects}</h2>
			<p className={clsx(fields.projectsLead)}>{settingsCopy.projectsLead}</p>
			<div className={clsx(fields.toolbar)}>
				<TextInput
					id="project-search"
					type="search"
					icon="search"
					width={fields.projectSearch}
					aria-label={settingsCopy.searchProjects}
					placeholder={settingsCopy.searchProjects}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				<span id="state-filter" className={clsx(headerControlStyle.group)}>
					<Segment
						id="state-tracked"
						label={`${settingsCopy.tracked} ${trackedCount}`}
						on={state === "tracked"}
						onClick={() => setState("tracked")}
					/>
					<Segment
						id="state-all"
						label={`${settingsCopy.all} ${projects.length}`}
						on={state === "all"}
						onClick={() => setState("all")}
					/>
				</span>
				{trackers.length < 2 ? null : (
					<span id="tracker-filter" className={clsx(headerControlStyle.group)}>
						{filters.map(({ kind, label }) => (
							<Segment
								key={kind}
								id={`tracker-${kind}`}
								label={label}
								on={tracker === kind}
								onClick={() => setTracker(kind)}
							/>
						))}
					</span>
				)}
				<span id="project-count" className={clsx(fields.count)}>
					{shown.length} {settingsCopy.of} {projects.length}{" "}
					{settingsCopy.projects}
				</span>
			</div>
			<table className={clsx(fields.table)}>
				<thead className={clsx(fields.head)}>
					<tr>
						<th className={clsx(fields.headCell)}>{settingsCopy.project}</th>
						<th className={clsx(fields.headSwitch)}>{settingsCopy.tracked}</th>
						<th className={clsx(fields.headSwitch)}>{settingsCopy.pinned}</th>
						<th className={clsx(fields.headSwitch)}>{settingsCopy.pmBot}</th>
						<th className={clsx(fields.headCell)}>
							{settingsCopy.expectedBots}
						</th>
						<th className={clsx(fields.headCell)}>{settingsSection.states}</th>
					</tr>
				</thead>
				<tbody>
					{shown.map((project) => (
						<ProjectRow
							key={`${project.tracker}:${project.key}`}
							project={project}
							draft={draft}
							onChange={onChange}
							onMapStates={() => setMapping(project)}
							onReviewBots={() => setReviewing(project)}
						/>
					))}
				</tbody>
			</table>
			{mapping === null || mappingSource === undefined ? null : (
				<StateMappingDialog
					project={mapping.name}
					projectKey={mapping.key}
					source={mappingSource}
					draft={draft}
					onChange={onChange}
					onClose={() => setMapping(null)}
				/>
			)}
			{reviewing === null ? null : (
				<ReviewBotsDialog
					project={reviewing}
					draft={draft}
					onChange={onChange}
					onClose={() => setReviewing(null)}
				/>
			)}
		</section>
	);
}

function ProjectRow({
	project,
	draft,
	onChange,
	onMapStates,
	onReviewBots,
}: {
	project: SettingsProject;
	draft: Configuration;
	onChange: (next: Partial<Configuration>) => void;
	onMapStates: () => void;
	onReviewBots: () => void;
}) {
	const id = `${project.tracker}-${project.key.replace(/[^A-Za-z0-9]+/g, "-")}`;
	const trackerLabel = useTrackerLabel();
	const tracked = isTracked(draft.tracked, project);
	const pinned = tracked && isTracked(draft.pinnedProjects, project);
	const names = [project.ref, ...project.savedPins];
	return (
		<tr id={`project-row-${id}`}>
			<td className={clsx(fields.cell)}>
				<div className={clsx(fields.projectName)}>{project.name}</div>
				<div className={clsx(fields.projectMeta)}>
					{trackerLabel(project.tracker)}
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
						onChange(
							next
								? { tracked: [...draft.tracked, project.ref] }
								: {
										tracked: withoutPins(draft.tracked, names),
										pinnedProjects: withoutPins(draft.pinnedProjects, names),
									},
						)
					}
				/>
			</td>
			<td className={clsx(fields.switchCell)}>
				{tracked ? (
					<Switch
						id={`pin-${id}`}
						checked={pinned}
						label={`${settingsCopy.pinned} ${project.name}`}
						onChange={(next) =>
							onChange({
								pinnedProjects: withPin(draft.pinnedProjects, {
									names,
									pin: pinOf(draft, project),
									on: next,
								}),
							})
						}
					/>
				) : null}
			</td>
			{tracked ? (
				<TrackedCells
					id={id}
					project={project}
					draft={draft}
					onChange={onChange}
					onMapStates={onMapStates}
					onReviewBots={onReviewBots}
				/>
			) : (
				<td colSpan={3} className={clsx(fields.cell, fields.projectMeta)}>
					{settingsCopy.trackOnlyHint}
				</td>
			)}
		</tr>
	);
}

function TrackedCells({
	id,
	project,
	draft,
	onChange,
	onMapStates,
	onReviewBots,
}: {
	id: string;
	project: SettingsProject;
	draft: Configuration;
	onChange: (next: Partial<Configuration>) => void;
	onMapStates: () => void;
	onReviewBots: () => void;
}) {
	const mapped =
		project.stateSource === undefined
			? 0
			: Object.keys(draft.stateMappings[project.stateSource] ?? {}).length;
	const bots = knownBots.filter((bot) =>
		project.repos.some((repo) => botsOf(draft, project, repo).includes(bot)),
	);
	return (
		<>
			<td className={clsx(fields.switchCell)}>
				<Switch
					id={`pm-bot-${id}`}
					checked={pmBotOf(draft, project)}
					label={`${settingsCopy.pmBot} ${project.name}`}
					onChange={(next) =>
						onChange({ pmBot: setPmBot(draft, project, next) })
					}
				/>
			</td>
			<td className={clsx(fields.cell)}>
				{project.repos.length === 0 ? (
					<span
						id={`bots-unavailable-${id}`}
						className={clsx(fields.projectMeta)}
					>
						{settingsCopy.botsUnavailable}
					</span>
				) : (
					<Button
						id={`review-bots-${id}`}
						icon="pencil"
						iconSide="right"
						label={bots.length === 0 ? settingsCopy.noBots : bots.join(", ")}
						name={`${settingsCopy.expectedBots} ${project.name}`}
						onClick={onReviewBots}
					/>
				)}
			</td>
			<td className={clsx(fields.cell)}>
				{project.stateSource === undefined ? (
					<span className={clsx(fields.projectMeta)}>
						{settingsCopy.notPolled}
					</span>
				) : (
					<span className={clsx(fields.mapCell)}>
						<Button
							id={`map-states-${id}`}
							label={settingsCopy.mapStates}
							onClick={onMapStates}
						/>
						{mapped === 0 ? null : (
							<span className={clsx(fields.projectMeta)}>
								{settingsCopy.mappedCount(mapped)}
							</span>
						)}
					</span>
				)}
			</td>
		</>
	);
}

function ReviewBotsDialog({
	project,
	draft,
	onChange,
	onClose,
}: {
	project: SettingsProject;
	draft: Configuration;
	onChange: (next: Partial<Configuration>) => void;
	onClose: () => void;
}) {
	return (
		<SettingsDialog
			id="review-bots-dialog"
			title={settingsCopy.reviewBotsOf(project.name)}
			lead={settingsCopy.reviewBotsLead}
			onClose={onClose}
		>
			{project.repos.map((repo) => {
				const bots = botsOf(draft, project, repo);
				const missing = knownBots.filter((bot) => !bots.includes(bot));
				const repoId = repo.replace(/[^A-Za-z0-9]+/g, "-");
				return (
					<div key={repo} className={clsx(settingsBots.repo)}>
						<span className={clsx(fields.rowTitle)}>{repo}</span>
						<div className={clsx(settingsBots.bots)}>
							{bots.length === 0 ? (
								<span className={clsx(fields.projectMeta)}>
									{settingsCopy.noBots}
								</span>
							) : (
								bots.map((bot) => (
									<Chip
										key={bot}
										label={bot}
										removeLabel={`${settingsCopy.remove} ${bot} ${repo}`}
										onRemove={() =>
											onChange({
												expectedBots: setBots(
													draft,
													project,
													repo,
													bots.filter((item) => item !== bot),
												),
											})
										}
									/>
								))
							)}
							{missing.length === 0 ? null : (
								<Select
									id={`add-bot-${repoId}`}
									aria-label={`${settingsCopy.addBot} ${repo}`}
									value={undefined}
									placeholder={settingsCopy.addBot}
									options={missing.map((bot) => ({ value: bot, label: bot }))}
									onChange={(bot) =>
										onChange({
											expectedBots: setBots(draft, project, repo, [
												...bots,
												bot,
											]),
										})
									}
								/>
							)}
						</div>
					</div>
				);
			})}
		</SettingsDialog>
	);
}
