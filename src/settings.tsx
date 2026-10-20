import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AutoMerge, Configuration } from "./configuration.ts";
import type { TicketState } from "./domain.ts";
import { PageFrame } from "./shell.tsx";
import {
	navLabel,
	settingsCopy,
	settingsSection,
	stateLabel,
} from "./terms.ts";
import { pageTheme } from "./theme.ts";
import { clsx } from "./ui.ts";
import { settings as fields, shell } from "./ui-styles.ts";
import {
	graphDirections,
	laneAgeCap,
	openViews,
	viewDefaults,
} from "./view-settings.ts";

type Trackers = { github: boolean; linear: boolean };

type SettingsBody = Configuration & { trackers?: Trackers };

const sections = [
	{ id: "general", label: settingsSection.general },
	{ id: "project-views", label: settingsSection.views },
	{ id: "review", label: settingsSection.review },
	{ id: "notifications", label: settingsSection.notifications },
	{ id: "trackers", label: settingsSection.trackers },
] as const;

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
	onSave,
}: {
	loaded: Configuration;
	trackers: Trackers;
	onSave: (next: Configuration) => Promise<string | null>;
}) {
	const [saved, setSaved] = useState(draftOf(loaded));
	const [draft, setDraft] = useState(draftOf(loaded));
	const [current, setCurrent] = useState<string>(sections[0].id);
	const [message, setMessage] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const [permission, setPermission] = useState("default");
	const dirty = !same(draft, saved);
	const view = draft.projectViews["*"] ?? viewDefaults();
	const theme = pageTheme();

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

	function patch(next: Partial<Configuration>): void {
		setDraft((currentDraft) => ({ ...currentDraft, ...next }));
		setMessage(null);
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
						<Row
							title={settingsCopy.activityWindow}
							hint={settingsCopy.activityHint}
						>
							<label className={clsx(fields.number)}>
								<input
									id="activity-window"
									className={clsx(fields.numberInput)}
									inputMode="numeric"
									value={String(draft.activityWindowDays)}
									onChange={(event) => {
										const days = Number(event.target.value);
										if (Number.isInteger(days) && days > 0) {
											patch({ activityWindowDays: days });
										}
									}}
								/>
								{settingsCopy.days}
							</label>
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
							<select
								id="open-view"
								className={clsx(fields.select)}
								value={view.openView}
								onChange={(event) => {
									const openView = openViews.find(
										(item) => item === event.target.value,
									);
									if (openView !== undefined) {
										patchView({ openView });
									}
								}}
							>
								{openViews.map((item) => (
									<option key={item} value={item}>
										{openViewLabel[item]}
									</option>
								))}
							</select>
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
						{message === null ? null : (
							<p
								id="settings-message"
								className={clsx(failed ? fields.error : fields.saved)}
							>
								{message}
							</p>
						)}
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
		</PageFrame>
	);

	async function onSaveClick(): Promise<void> {
		const error = await onSave(draft);
		setFailed(error !== null);
		setMessage(error ?? settingsCopy.saved);
		if (error === null) {
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
	board: settingsCopy.openBoard,
	graph: settingsCopy.openGraph,
	table: settingsCopy.openTable,
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
	const { trackers: _trackers, ...configuration } = body;
	return configuration;
}

function Page() {
	const [settings, setSettings] = useState<Configuration | null>(null);
	const [trackers, setTrackers] = useState<Trackers>({
		github: false,
		linear: false,
	});
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let stopped = false;
		fetch("/api/settings")
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`settings failed (HTTP ${response.status})`);
				}
				return (await response.json()) as SettingsBody;
			})
			.then((body) => {
				if (!stopped) {
					setTrackers(body.trackers ?? { github: false, linear: false });
					setSettings(configurationOf(body));
				}
			})
			.catch((cause: unknown) => {
				if (!stopped) {
					setError(cause instanceof Error ? cause.message : "settings failed");
				}
			});
		return () => {
			stopped = true;
		};
	}, []);
	if (error !== null) {
		return <PageFrame title={navLabel.settings}>{error}</PageFrame>;
	}
	if (settings === null) {
		return <PageFrame title={navLabel.settings}>Loading settings</PageFrame>;
	}
	return (
		<Menu
			loaded={settings}
			trackers={trackers}
			onSave={async (next) => {
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
						pinned: live.pinned,
						hidden: live.hidden,
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
				setTrackers(body.trackers ?? trackers);
				setSettings(configurationOf(body));
				return null;
			}}
		/>
	);
}

if (typeof document !== "undefined") {
	const root = document.getElementById("root");
	if (root !== null) {
		createRoot(root).render(<Page />);
	}
}
