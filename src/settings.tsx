import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useHoldReload } from "./boot-reload.tsx";
import type { Configuration } from "./configuration.ts";
import type { BackendViews, SettingsProject } from "./domain.ts";
import type { FactoryEntry } from "./factories.ts";
import type { FactoryTokenReport } from "./factory-tokens.ts";
import { PageLoading } from "./loading.tsx";
import { pageQuery } from "./queries-page.ts";
import { useSaveSettings } from "./queries-settings.ts";
import { FactoriesSection } from "./settings-factories.tsx";
import { type SectionId, sectionOf, sections } from "./settings-parts.tsx";
import { ProjectsTable } from "./settings-projects.tsx";
import {
	ContentsNav,
	GeneralSection,
	NotificationsSection,
	patchStar,
	ProjectViewsSection,
	ReviewSection,
	SettingsBar,
	TrackersSection,
} from "./settings-sections.tsx";
import { StatesSection } from "./settings-states.tsx";
import { settings as fields } from "./settings-styles.ts";
import { settingsCopy } from "./settings-terms.ts";
import type { StateSource } from "./settings-write.ts";
import { PageFrame, PollStatus } from "./shell.tsx";
import { shippedStates } from "./state-colours.ts";
import { navLabel } from "./terms.ts";
import { pageTheme, watchPageTheme } from "./theme.ts";
import { Toast } from "./toast.tsx";
import { clsx } from "./ui.ts";
import { useUrlParam } from "./url-param.ts";
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

function unsavedSections(
	draft: Configuration,
	saved: Configuration,
): SectionId[] {
	const keys = Object.keys({ ...saved, ...draft }) as (keyof Configuration)[];
	const changed = new Set(
		keys.flatMap((key) =>
			sameValue(draft[key], saved[key]) ? [] : [sectionOf(key)],
		),
	);
	return sections.flatMap((section) =>
		changed.has(section.id) ? [section.id] : [],
	);
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
	backends,
	projects,
	discoveryErrors,
	factoryTokenReports,
	factoryEntries,
	stateSources,
	polling,
	onSave,
	onResetStates,
}: {
	loaded: Configuration;
	backends: BackendViews;
	projects: SettingsProject[];
	discoveryErrors: string[];
	factoryTokenReports: FactoryTokenReport[];
	factoryEntries: FactoryEntry[];
	stateSources: StateSource[];
	polling: boolean;
	onSave: (
		next: Configuration,
		baseline: Configuration,
	) => Promise<string | null>;
	onResetStates: () => Promise<string | null>;
}) {
	const [saved, setSaved] = useState(draftOf(loaded));
	const [draft, setDraft] = useState(draftOf(loaded));
	const baseline = useRef(saved);
	const [sectionParam, setSection] = useUrlParam("section");
	const current =
		sections.find((section) => section.id === sectionParam)?.id ??
		sections[0].id;
	const [message, setMessage] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const [toast, setToast] = useState(0);
	const [saving, setSaving] = useState(false);
	const [permission, setPermission] = useState("default");
	const unsaved = unsavedSections(draft, saved);
	const dirty = unsaved.length > 0;
	useHoldReload(dirty);
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

	function patch(next: Partial<Configuration>): void {
		setDraft((currentDraft) => ({ ...currentDraft, ...next }));
		setMessage(null);
		setFailed(false);
		setToast(0);
	}

	const shown = new Set(
		view.shownLanes ??
			draft.states.flatMap((state) =>
				state.categories.every((category) => category === "dropped") &&
				state.categories.length > 0
					? []
					: [state.label],
			),
	);

	return (
		<PageFrame
			title={navLabel.settings}
			subtitle={<PollStatus text={null} polling={polling} />}
		>
			<p id="settings-lead" className={clsx(fields.lead)}>
				{settingsCopy.savedTo}
			</p>
			<div className={clsx(fields.layout)}>
				<ContentsNav
					current={current}
					unsaved={new Set(unsaved)}
					onSelect={setSection}
				/>
				<div className={clsx(fields.panel)}>
					{current === "general" ? (
						<GeneralSection
							theme={theme}
							draft={draft}
							factoryTokenReports={factoryTokenReports}
							switches={backends.switches}
							onChange={patch}
						/>
					) : current === "project-views" ? (
						<ProjectViewsSection
							view={view}
							states={draft.states}
							shown={shown}
							onPatchView={(next) => patchStar(draft, view, patch, next)}
						/>
					) : current === "projects" ? (
						<ProjectsTable
							projects={projects}
							trackers={backends.trackers}
							sources={stateSources}
							draft={draft}
							onChange={patch}
						/>
					) : current === "states" ? (
						<StatesSection
							draft={draft}
							onChange={patch}
							onReset={() => {
								void onResetClick();
							}}
						/>
					) : current === "review" ? (
						<ReviewSection
							draft={draft}
							laneHint={backends.hints.laneMappings}
							onChange={patch}
						/>
					) : current === "notifications" ? (
						<NotificationsSection
							draft={draft}
							permission={permission}
							onChange={patch}
						/>
					) : current === "trackers" ? (
						<TrackersSection
							backends={backends}
							discoveryErrors={discoveryErrors}
						/>
					) : (
						<FactoriesSection
							draft={draft}
							entries={factoryEntries}
							runStartHint={backends.hints.runStart}
							onChange={patch}
						/>
					)}
					<SettingsBar
						unsaved={unsaved}
						saving={saving}
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
					{message === null ? null : (
						<Toast
							key={toast}
							id="settings-toast"
							message={message}
							tone={failed ? "error" : "saved"}
							hideMs={toast === 0 || failed ? undefined : toastHideMs}
							onClose={() => {
								setMessage(null);
								setToast(0);
							}}
						/>
					)}
				</div>
			</div>
		</PageFrame>
	);

	async function onResetClick(): Promise<void> {
		const error = await onResetStates();
		setFailed(error !== null);
		setMessage(error ?? settingsCopy.savedToast);
		setToast((shown) => shown + 1);
		if (error === null) {
			const reset = { states: shippedStates, stateMappings: {} };
			baseline.current = { ...baseline.current, ...reset };
			setSaved((current) => ({ ...current, ...reset }));
			setDraft((current) => ({ ...current, ...reset }));
		}
	}

	async function onSaveClick(): Promise<void> {
		// A save that changes more than the views waits for a full poll before it answers.
		setSaving(true);
		setFailed(false);
		setMessage(settingsCopy.savingToast);
		setToast(0);
		const error = await onSave(draft, saved);
		setSaving(false);
		setFailed(error !== null);
		setMessage(error ?? settingsCopy.savedToast);
		setToast((shown) => shown + 1);
		if (error === null) {
			baseline.current = draft;
			setSaved(draft);
		}
	}
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
		return (
			<PageFrame title={navLabel.settings}>
				<PageLoading />
			</PageFrame>
		);
	}
	return (
		<Menu
			loaded={loaded.settings}
			backends={loaded.backends}
			projects={loaded.projects}
			discoveryErrors={loaded.discoveryErrors}
			factoryTokenReports={loaded.factoryTokenReports}
			factoryEntries={loaded.factoryEntries}
			stateSources={loaded.stateSources}
			polling={polling}
			onResetStates={async () => {
				try {
					await save.mutateAsync((live) => ({
						...live,
						states: shippedStates,
						stateMappings: {},
					}));
				} catch (cause) {
					return cause instanceof Error ? cause.message : "save failed";
				}
				return null;
			}}
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
							overview: {
								...live.overview,
								showNeedsYou:
									next.overview.showNeedsYou === baseline.overview.showNeedsYou
										? live.overview.showNeedsYou
										: next.overview.showNeedsYou,
							},
							tracked: next.tracked,
							baselineTracked: baseline.tracked,
							pinnedProjects: next.pinnedProjects,
							baselinePinnedProjects: baseline.pinnedProjects,
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
