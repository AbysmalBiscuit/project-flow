import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { AutoMerge, Configuration, ProjectPin } from "./configuration.ts";
import type { SettingsProject, TicketState } from "./domain.ts";
import { projectHasPmBot, samePin } from "./domain.ts";
import { Dropdown } from "./dropdown.tsx";
import { onAppEvent } from "./events.ts";
import type { KnownBot } from "./known-bots.ts";
import { knownBots } from "./known-bots.ts";
import { mountPage, readPageCache, writePageCache } from "./page-cache.ts";
import { PageFrame } from "./shell.tsx";
import {
	loadingLabel,
	navLabel,
	settingsCopy,
	settingsSection,
	stateLabel,
	viewLabel,
} from "./terms.ts";
import { pageTheme, watchPageTheme } from "./theme.ts";
import { clsx } from "./ui.ts";
import { settings as fields, shell } from "./ui-styles.ts";
import {
	defaultOpenView,
	graphDirections,
	laneAgeCap,
	openViews,
	viewDefaults,
} from "./view-settings.ts";

type Trackers = { github: boolean; linear: boolean };

type SettingsBody = Configuration & {
	trackers?: Trackers;
	projects?: SettingsProject[];
};

const toastHideMs = 4_000;

const sections = [
	{ id: "general", label: settingsSection.general },
	{ id: "project-views", label: settingsSection.views },
	{ id: "projects", label: settingsSection.projects },
	{ id: "review", label: settingsSection.review },
	{ id: "notifications", label: settingsSection.notifications },
	{ id: "trackers", label: settingsSection.trackers },
] as const;

const trackerFilters = ["all", "github", "linear"] as const;
const stateFilters = ["all", "tracked"] as const;

const laneStates = [
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"done",
] as const satisfies readonly TicketState[];

const pollChoices = [30, 60, 300, 600] as const;

const ageChoices = [0, 2, 7, 14, 30] as const;

const evidenceStates = [
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"done",
	"dropped",
] as const satisfies readonly TicketState[];

const autoMergeChoices = ["yes", "ask", "no"] as const;

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

function pollLabel(seconds: number): string {
	if (seconds % 60 === 0) {
		const minutes = seconds / 60;
		return minutes === 1 ? "1 minute" : `${minutes} minutes`;
	}
	return `${seconds} seconds`;
}

function ageLabel(days: number): string {
	if (days === 0) {
		return settingsCopy.anyAge;
	}
	return days === 1 ? "1 day" : `${days} days`;
}

function Switch({
	id,
	checked,
	label,
	onChange,
}: {
	id: string;
	checked: boolean;
	label: string;
	onChange: (next: boolean) => void;
}) {
	return (
		<button
			id={id}
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			className={clsx(fields.switch, checked && fields.switchOn)}
			onClick={() => onChange(!checked)}
		>
			<span className={clsx(fields.knob, checked && fields.knobOn)} />
		</button>
	);
}

function Row({
	title,
	hint,
	children,
}: {
	title: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<div className={clsx(fields.row)}>
			<div className={clsx(fields.rowText)}>
				<span className={clsx(fields.rowTitle)}>{title}</span>
				{hint === undefined ? null : (
					<span className={clsx(fields.hint)}>{hint}</span>
				)}
			</div>
			{children}
		</div>
	);
}

function Chips({
	id,
	values,
	placeholder,
	onChange,
}: {
	id: string;
	values: string[];
	placeholder: string;
	onChange: (next: string[]) => void;
}) {
	const [text, setText] = useState("");
	return (
		<div className={clsx(fields.chips)}>
			{values.map((value) => (
				<span key={value} className={clsx(fields.chip)}>
					{value}
					<button
						type="button"
						className={clsx(fields.chipRemove)}
						aria-label={`Remove ${value}`}
						onClick={() => onChange(values.filter((item) => item !== value))}
					>
						×
					</button>
				</span>
			))}
			<input
				id={id}
				className={clsx(fields.chipInput)}
				placeholder={placeholder}
				value={text}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={(event) => {
					if (event.key !== "Enter") {
						return;
					}
					event.preventDefault();
					const next = text.trim();
					if (next === "" || values.includes(next)) {
						setText("");
						return;
					}
					onChange([...values, next]);
					setText("");
				}}
			/>
		</div>
	);
}

function Menu({
	loaded,
	trackers,
	projects,
	onSave,
}: {
	loaded: Configuration;
	trackers: Trackers;
	projects: SettingsProject[];
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

	function patchView(
		next: Partial<NonNullable<Configuration["projectViews"][string]>>,
	): void {
		patch({
			projectViews: {
				...draft.projectViews,
				"*": { ...view, ...next },
			},
		});
	}

	const shown = new Set(
		view.shownLanes ?? laneStates.map((state) => stateLabel[state]),
	);

	return (
		<PageFrame title={navLabel.settings} scroll>
			<p id="settings-lead" className={clsx(fields.lead)}>
				{settingsCopy.savedTo}
			</p>
			<div className={clsx(fields.layout)}>
				<nav
					id="settings-contents"
					className={clsx(fields.contents)}
					aria-label="Contents"
				>
					{sections.map((section) => (
						<a
							key={section.id}
							id={`contents-${section.id}`}
							href={`#${section.id}`}
							className={clsx(
								fields.contentsLink,
								shell.linkFocus,
								current === section.id && fields.contentsCurrent,
							)}
							aria-current={current === section.id ? "true" : undefined}
							onClick={() => setCurrent(section.id)}
						>
							{section.label}
						</a>
					))}
				</nav>
				<div>
					<section id="general" className={clsx(fields.card)}>
						<h2 className={clsx(fields.cardTitle)}>
							{settingsSection.general}
						</h2>
						<Row title={settingsCopy.theme} hint={settingsCopy.themeHint}>
							<span id="theme-value">
								{theme === "dark" ? navLabel.dark : navLabel.light}
							</span>
						</Row>
						<Row title={settingsCopy.pollInterval} hint={settingsCopy.pollHint}>
							<select
								id="poll-interval"
								className={clsx(fields.select)}
								value={String(draft.pollIntervalSeconds)}
								onChange={(event) =>
									patch({ pollIntervalSeconds: Number(event.target.value) })
								}
							>
								{pollChoices.map((seconds) => (
									<option key={seconds} value={seconds}>
										{pollLabel(seconds)}
									</option>
								))}
								{pollChoices.find(
									(seconds) => seconds === draft.pollIntervalSeconds,
								) !== undefined ? null : (
									<option value={draft.pollIntervalSeconds}>
										{pollLabel(draft.pollIntervalSeconds)}
									</option>
								)}
							</select>
						</Row>
					</section>

					<section id="project-views" className={clsx(fields.card)}>
						<h2 className={clsx(fields.cardTitle)}>{settingsSection.views}</h2>
						<p className={clsx(fields.hint)}>{settingsCopy.viewsLead}</p>
						<Row title={settingsCopy.openIn} hint={settingsCopy.openHint}>
							<Dropdown
								id="open-view"
								label={settingsCopy.openIn}
								value={view.openView ?? defaultOpenView}
								choices={openViews.map((item) => ({
									id: item,
									label: openViewLabel[item],
								}))}
								onChange={(id) => {
									const openView = openViews.find((item) => item === id);
									if (openView !== undefined) {
										patchView({ openView });
									}
								}}
							/>
						</Row>
						<Row
							title={settingsCopy.graphDirection}
							hint={settingsCopy.graphHint}
						>
							<select
								id="graph-direction"
								className={clsx(fields.select)}
								value={view.graphDirection}
								onChange={(event) => {
									const graphDirection = graphDirections.find(
										(item) => item === event.target.value,
									);
									if (graphDirection !== undefined) {
										patchView({ graphDirection });
									}
								}}
							>
								{graphDirections.map((item) => (
									<option key={item} value={item}>
										{graphDirectionLabel[item]}
									</option>
								))}
							</select>
						</Row>
						<Row
							title={settingsCopy.ticketFilter}
							hint={settingsCopy.ticketHint}
						>
							<span />
						</Row>
						{laneStates.map((state) => {
							const on = shown.has(stateLabel[state]);
							const days = laneAgeCap(
								view.maxAgeDays,
								stateLabel[state],
								state,
							);
							return (
								<div key={state} className={clsx(fields.row)}>
									<span className={clsx(fields.lane)}>
										<Switch
											id={`lane-${state}`}
											checked={on}
											label={stateLabel[state]}
											onChange={(next) => {
												const names = laneStates.flatMap((item) =>
													(item === state ? next : shown.has(stateLabel[item]))
														? [stateLabel[item]]
														: [],
												);
												patchView({ shownLanes: names });
											}}
										/>
										<span
											className={clsx(
												fields.dot,
												state === "backlog" && fields.dotBacklog,
												state === "inProgress" && fields.dotProgress,
												state === "inReview" && fields.dotReview,
												state === "awaitingMerge" && fields.dotMerge,
												state === "done" && fields.dotDone,
											)}
										/>
										{stateLabel[state]}
									</span>
									<select
										id={`age-${state}`}
										className={clsx(fields.select)}
										aria-label={`${stateLabel[state]} age`}
										value={String(days)}
										onChange={(event) =>
											patchView({
												maxAgeDays: {
													...view.maxAgeDays,
													[stateLabel[state]]: Number(event.target.value),
												},
											})
										}
									>
										{ageChoices.map((choice) => (
											<option key={choice} value={choice}>
												{ageLabel(choice)}
											</option>
										))}
									</select>
								</div>
							);
						})}
						<Row
							title={settingsCopy.needsYouOnly}
							hint={settingsCopy.needsYouOnlyHint}
						>
							<Switch
								id="needs-you-only"
								checked={view.needsYouOnly}
								label={settingsCopy.needsYouOnly}
								onChange={(next) => patchView({ needsYouOnly: next })}
							/>
						</Row>
						<Row
							title={settingsCopy.blockedOnly}
							hint={settingsCopy.blockedOnlyHint}
						>
							<Switch
								id="blocked-only"
								checked={view.blockedOnly}
								label={settingsCopy.blockedOnly}
								onChange={(next) => patchView({ blockedOnly: next })}
							/>
						</Row>
					</section>

					<ProjectsTable projects={projects} draft={draft} onChange={patch} />

					<section id="review" className={clsx(fields.card)}>
						<h2 className={clsx(fields.cardTitle)}>{settingsSection.review}</h2>
						<Row title={settingsCopy.labels} hint={settingsCopy.labelsHint}>
							<Chips
								id="needs-you-labels"
								values={draft.needsYouLabels}
								placeholder={settingsCopy.addLabel}
								onChange={(needsYouLabels) => patch({ needsYouLabels })}
							/>
						</Row>
						<Row title={settingsCopy.logins} hint={settingsCopy.loginsHint}>
							<Chips
								id="viewer-logins"
								values={draft.viewerLogins}
								placeholder={settingsCopy.addLogin}
								onChange={(viewerLogins) => patch({ viewerLogins })}
							/>
						</Row>
						<Row title={settingsCopy.laneMappings} hint={settingsCopy.laneHint}>
							<MappingEditor
								mappings={draft.laneMappings}
								onChange={(laneMappings) => patch({ laneMappings })}
							/>
						</Row>
						<Row
							title={settingsCopy.autoMerge}
							hint={settingsCopy.autoMergeHint}
						>
							<AutoMergeEditor
								overrides={draft.autoMerge}
								onChange={(autoMerge) => patch({ autoMerge })}
							/>
						</Row>
					</section>

					<section id="notifications" className={clsx(fields.card)}>
						<h2 className={clsx(fields.cardTitle)}>
							{settingsSection.notifications}
						</h2>
						<Row title={navLabel.needsYou} hint={settingsCopy.needsYouHint}>
							<Switch
								id="trigger-needs-you"
								checked={draft.notificationTriggers.needsYou}
								label={navLabel.needsYou}
								onChange={(needsYou) =>
									patch({
										notificationTriggers: {
											...draft.notificationTriggers,
											needsYou,
										},
									})
								}
							/>
						</Row>
						<Row
							title={settingsCopy.newComment}
							hint={settingsCopy.newCommentHint}
						>
							<Switch
								id="trigger-comment"
								checked={draft.notificationTriggers.comment}
								label={settingsCopy.newComment}
								onChange={(comment) =>
									patch({
										notificationTriggers: {
											...draft.notificationTriggers,
											comment,
										},
									})
								}
							/>
						</Row>
						<Row
							title={settingsCopy.blockerCleared}
							hint={settingsCopy.blockerClearedHint}
						>
							<Switch
								id="trigger-blocker"
								checked={draft.notificationTriggers.blockerCleared}
								label={settingsCopy.blockerCleared}
								onChange={(blockerCleared) =>
									patch({
										notificationTriggers: {
											...draft.notificationTriggers,
											blockerCleared,
										},
									})
								}
							/>
						</Row>
						<Row
							title={settingsCopy.browserPermission}
							hint={settingsCopy.browserHint}
						>
							<span
								id="browser-permission"
								className={clsx(
									fields.status,
									permission === "granted" && fields.statusOn,
								)}
							>
								{permission === "granted"
									? settingsCopy.allowed
									: permission === "denied"
										? settingsCopy.blocked
										: settingsCopy.asking}
							</span>
						</Row>
					</section>

					<section id="trackers" className={clsx(fields.card)}>
						<h2 className={clsx(fields.cardTitle)}>
							{settingsSection.trackers}
						</h2>
						<p className={clsx(fields.hint)}>{settingsCopy.trackersLead}</p>
						<Row title={settingsCopy.github} hint={settingsCopy.githubHint}>
							<Credential id="github-status" present={trackers.github} />
						</Row>
						<Row title={settingsCopy.linear} hint={settingsCopy.linearHint}>
							<Credential id="linear-status" present={trackers.linear} />
						</Row>
					</section>

					<div className={clsx(fields.bar)}>
						<button
							id="discard-settings"
							type="button"
							className={clsx(
								shell.button,
								shell.buttonHover,
								shell.buttonFocus,
							)}
							disabled={!dirty}
							onClick={() => {
								setDraft(saved);
								setFailed(false);
								setMessage(null);
								setToast(0);
							}}
						>
							{settingsCopy.discard}
						</button>
						<button
							id="save-settings"
							type="button"
							className={clsx(fields.save, shell.buttonFocus)}
							disabled={!dirty}
							onClick={() => {
								void onSaveClick();
							}}
						>
							{settingsCopy.save}
						</button>
					</div>
				</div>
			</div>
			{message === null ? null : (
				<p
					id="settings-toast"
					className={clsx(
						fields.toast,
						failed ? fields.toastError : fields.toastSaved,
					)}
					role={failed ? "alert" : "status"}
				>
					{message}
				</p>
			)}
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

function Credential({ id, present }: { id: string; present: boolean }) {
	return (
		<span id={id} className={clsx(fields.status, present && fields.statusOn)}>
			{present ? settingsCopy.connected : settingsCopy.missing}
		</span>
	);
}

function MappingEditor({
	mappings,
	onChange,
}: {
	mappings: Configuration["laneMappings"];
	onChange: (next: Configuration["laneMappings"]) => void;
}) {
	const [key, setKey] = useState("");
	const [state, setState] =
		useState<(typeof evidenceStates)[number]>("awaitingMerge");
	const [status, setStatus] = useState("");
	const rows = Object.entries(mappings);
	function add(): void {
		const name = key.trim();
		const named = status.trim();
		if (name === "" || named === "") {
			return;
		}
		onChange({
			...mappings,
			[name]: { ...mappings[name], [state]: named },
		});
		setStatus("");
	}
	return (
		<div className={clsx(fields.chips)}>
			{rows.map(([name, mapping]) =>
				evidenceStates.flatMap((item) => {
					const value = mapping[item];
					return value === undefined
						? []
						: [
								<span key={`${name}-${item}`} className={clsx(fields.chip)}>
									{name} {stateLabel[item]} {value}
									<button
										type="button"
										className={clsx(fields.chipRemove)}
										aria-label={`Remove ${name} ${stateLabel[item]}`}
										onClick={() => {
											const next = { ...mapping };
											delete next[item];
											const kept = { ...mappings };
											if (Object.keys(next).length === 0) {
												delete kept[name];
											} else {
												kept[name] = next;
											}
											onChange(kept);
										}}
									>
										×
									</button>
								</span>,
							];
				}),
			)}
			<input
				id="lane-mapping-key"
				className={clsx(fields.chipInput)}
				aria-label={settingsCopy.mappingKey}
				placeholder={settingsCopy.mappingKey}
				value={key}
				onChange={(event) => setKey(event.target.value)}
			/>
			<select
				id="lane-mapping-state"
				className={clsx(fields.select)}
				aria-label={settingsCopy.laneState}
				value={state}
				onChange={(event) => {
					const next = evidenceStates.find(
						(item) => item === event.target.value,
					);
					if (next !== undefined) {
						setState(next);
					}
				}}
			>
				{evidenceStates.map((item) => (
					<option key={item} value={item}>
						{stateLabel[item]}
					</option>
				))}
			</select>
			<input
				id="lane-mapping-status"
				className={clsx(fields.chipInput)}
				aria-label={settingsCopy.statusName}
				placeholder={settingsCopy.statusName}
				value={status}
				onKeyDown={(event) => {
					if (event.key !== "Enter") {
						return;
					}
					event.preventDefault();
					add();
				}}
				onChange={(event) => setStatus(event.target.value)}
			/>
			<button
				id="lane-mapping-add"
				type="button"
				className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
				onClick={add}
			>
				{settingsCopy.add}
			</button>
		</div>
	);
}

const autoMergeLabel: Record<AutoMerge, string> = {
	yes: settingsCopy.yes,
	ask: settingsCopy.ask,
	no: settingsCopy.no,
};

const openViewLabel: Record<(typeof openViews)[number], string> = {
	board: viewLabel.board,
	graph: viewLabel.graph,
	table: viewLabel.table,
	last: viewLabel.lastUsed,
};

const graphDirectionLabel: Record<(typeof graphDirections)[number], string> = {
	"left-to-right": settingsCopy.leftToRight,
	"top-to-bottom": settingsCopy.topToBottom,
};

function AutoMergeEditor({
	overrides,
	onChange,
}: {
	overrides: Configuration["autoMerge"];
	onChange: (next: Configuration["autoMerge"]) => void;
}) {
	const [repo, setRepo] = useState("");
	const [choice, setChoice] = useState<AutoMerge>("ask");
	const rows = Object.entries(overrides);
	function add(): void {
		const name = repo.trim();
		if (name === "") {
			return;
		}
		onChange({ ...overrides, [name]: choice });
		setRepo("");
	}
	return (
		<div className={clsx(fields.chips)}>
			{rows.map(([name, value]) => (
				<span key={name} className={clsx(fields.chip)}>
					{name} {value}
					<button
						type="button"
						className={clsx(fields.chipRemove)}
						aria-label={`Remove ${name}`}
						onClick={() => {
							const next = { ...overrides };
							delete next[name];
							onChange(next);
						}}
					>
						×
					</button>
				</span>
			))}
			<input
				id="auto-merge-repo"
				className={clsx(fields.chipInput)}
				aria-label={settingsCopy.repo}
				placeholder={settingsCopy.repo}
				value={repo}
				onChange={(event) => setRepo(event.target.value)}
			/>
			<select
				id="auto-merge-value"
				className={clsx(fields.select)}
				aria-label={settingsCopy.autoMerge}
				value={choice}
				onChange={(event) => {
					const next = autoMergeChoices.find(
						(item) => item === event.target.value,
					);
					if (next !== undefined) {
						setChoice(next);
					}
				}}
			>
				{autoMergeChoices.map((item) => (
					<option key={item} value={item}>
						{autoMergeLabel[item]}
					</option>
				))}
			</select>
			<button
				id="auto-merge-add"
				type="button"
				className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
				onClick={add}
			>
				{settingsCopy.add}
			</button>
		</div>
	);
}

function configurationOf(body: SettingsBody): Configuration {
	const { trackers: _trackers, projects: _projects, ...configuration } = body;
	return configuration;
}

function SearchGlyph() {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={clsx(fields.filterGlyph)}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle cx="11" cy="11" r="6.5" />
			<path d="M16 16l4 4" />
		</svg>
	);
}

function FilterGlyph() {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={clsx(fields.filterGlyph)}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M4 5h16l-6 7.5V19l-4 2v-8.5L4 5z" />
		</svg>
	);
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
	if (Object.hasOwn(draft.expectedBots ?? {}, repo)) {
		return draft.expectedBots?.[repo] ?? [];
	}
	return project.repoBots[repo] ?? [];
}

function setBots(
	draft: Configuration,
	project: SettingsProject,
	repo: string,
	bots: KnownBot[],
): Configuration["expectedBots"] {
	const seeded = Object.hasOwn(draft.expectedBots ?? {}, repo)
		? {}
		: Object.fromEntries(
				project.repos
					.filter((name) => !Object.hasOwn(draft.expectedBots ?? {}, name))
					.map((name) => [name, project.repoBots[name] ?? []]),
			);
	return { ...draft.expectedBots, ...seeded, [repo]: bots };
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
							<div key={repo} className={clsx(fields.bots)}>
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
										className={clsx(fields.addBot)}
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

function Page() {
	const cached = readPageCache("settings-page");
	const [settings, setSettings] = useState<Configuration | null>(
		() => cached?.settings ?? null,
	);
	const [projects, setProjects] = useState<SettingsProject[]>(
		() => cached?.projects ?? [],
	);
	const [trackers, setTrackers] = useState<Trackers>(
		() => cached?.trackers ?? { github: false, linear: false },
	);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let stopped = false;
		const load = () => {
			fetch("/api/settings")
				.then(async (response) => {
					if (!response.ok) {
						throw new Error(`settings failed (HTTP ${response.status})`);
					}
					return (await response.json()) as SettingsBody;
				})
				.then((body) => {
					if (stopped) {
						return;
					}
					const next = {
						trackers: body.trackers ?? { github: false, linear: false },
						projects: body.projects ?? [],
						settings: configurationOf(body),
					};
					writePageCache("settings-page", next);
					setTrackers(next.trackers);
					setProjects(next.projects);
					setSettings(next.settings);
				})
				.catch((cause: unknown) => {
					if (!stopped) {
						setError(
							cause instanceof Error ? cause.message : "settings failed",
						);
					}
				});
		};
		load();
		const stop = onAppEvent("overview", () => {
			if (!stopped) {
				load();
			}
		});
		return () => {
			stopped = true;
			stop();
		};
	}, []);
	if (error !== null) {
		return <PageFrame title={navLabel.settings}>{error}</PageFrame>;
	}
	if (settings === null) {
		return <PageFrame title={navLabel.settings}>{loadingLabel}</PageFrame>;
	}
	return (
		<Menu
			loaded={settings}
			trackers={trackers}
			projects={projects}
			onSave={async (next, baseline) => {
				const current = await fetch("/api/settings");
				if (!current.ok) {
					return `settings failed (HTTP ${current.status})`;
				}
				const live = (await current.json()) as SettingsBody;
				const star = next.projectViews["*"] ?? live.projectViews["*"];
				const response = await fetch("/api/settings", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...configurationOf(live),
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
					}),
				});
				const body = (await response.json().catch(() => null)) as
					| (SettingsBody & { error?: string })
					| null;
				if (!response.ok) {
					return body?.error ?? `save failed (HTTP ${response.status})`;
				}
				if (body === null) {
					throw new Error("save failed");
				}
				const saved = {
					trackers: body.trackers ?? trackers,
					projects: body.projects ?? [],
					settings: configurationOf(body),
				};
				writePageCache("settings-page", saved);
				setTrackers(saved.trackers);
				setProjects(saved.projects);
				setSettings(saved.settings);
				return null;
			}}
		/>
	);
}

function mount(): void {
	if (window.location.pathname !== "/settings") {
		return;
	}
	mountPage((root) => {
		root.render(<Page />);
	});
}

if (typeof document !== "undefined") {
	window.addEventListener("project-flow-page", mount);
	mount();
}
