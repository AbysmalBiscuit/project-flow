import type { Configuration } from "./configuration.ts";
import { Dropdown } from "./dropdown.tsx";
import { FactoryTokenRow, PollIntervalRow } from "./factory-token-row.tsx";
import {
	AutoMergeEditor,
	ageChoices,
	ageLabel,
	Chips,
	Credential,
	laneStates,
	MappingEditor,
	openViewLabel,
	Row,
	Switch,
	sections,
	type Trackers,
} from "./settings-parts.tsx";
import { settings as fields } from "./settings-styles.ts";
import { stateTones } from "./state-tone.ts";
import {
	graphDirectionLabel,
	navLabel,
	settingsCopy,
	settingsSection,
	stateLabel,
} from "./terms.ts";
import { clsx } from "./ui.ts";
import { shell } from "./ui-styles.ts";
import {
	defaultOpenView,
	graphDirections,
	laneAgeCap,
	openViews,
} from "./view-settings.ts";

type ViewDraft = NonNullable<Configuration["projectViews"][string]>;

export function patchStar(
	draft: Configuration,
	view: ViewDraft,
	patch: (next: Partial<Configuration>) => void,
	next: Partial<ViewDraft>,
): void {
	patch({
		projectViews: {
			...draft.projectViews,
			"*": { ...view, ...next },
		},
	});
}

export function ContentsNav({
	current,
	onSelect,
}: {
	current: string;
	onSelect: (id: string) => void;
}) {
	return (
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
					onClick={() => onSelect(section.id)}
				>
					{section.label}
				</a>
			))}
		</nav>
	);
}

export function GeneralSection({
	theme,
	draft,
	onChange,
}: {
	theme: string;
	draft: Configuration;
	onChange: (next: Partial<Configuration>) => void;
}) {
	return (
		<section id="general" className={clsx(fields.card)}>
			<h2 className={clsx(fields.cardTitle)}>{settingsSection.general}</h2>
			<Row title={settingsCopy.theme} hint={settingsCopy.themeHint}>
				<span id="theme-value">
					{theme === "dark" ? navLabel.dark : navLabel.light}
				</span>
			</Row>
			<FactoryTokenRow
				checked={draft.factoryGithubTokens}
				onChange={onChange}
			/>
			<PollIntervalRow
				seconds={draft.pollIntervalSeconds}
				onChange={onChange}
			/>
		</section>
	);
}

function LaneAgeRow({
	state,
	shown,
	view,
	onPatchView,
}: {
	state: (typeof laneStates)[number];
	shown: Set<string>;
	view: ViewDraft;
	onPatchView: (next: Partial<ViewDraft>) => void;
}) {
	const on = shown.has(stateLabel[state]);
	const days = laneAgeCap(view.maxAgeDays, stateLabel[state], state);
	return (
		<div className={clsx(fields.row)}>
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
						onPatchView({ shownLanes: names });
					}}
				/>
				<span className={clsx(fields.dot, stateTones[state])} />
				{stateLabel[state]}
			</span>
			<select
				id={`age-${state}`}
				className={clsx(fields.select)}
				aria-label={`${stateLabel[state]} age`}
				value={String(days)}
				onChange={(event) =>
					onPatchView({
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
}

export function ProjectViewsSection({
	view,
	shown,
	onPatchView,
}: {
	view: ViewDraft;
	shown: Set<string>;
	onPatchView: (next: Partial<ViewDraft>) => void;
}) {
	return (
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
							onPatchView({ openView });
						}
					}}
				/>
			</Row>
			<Row title={settingsCopy.graphDirection} hint={settingsCopy.graphHint}>
				<select
					id="graph-direction"
					className={clsx(fields.select)}
					value={view.graphDirection}
					onChange={(event) => {
						const graphDirection = graphDirections.find(
							(item) => item === event.target.value,
						);
						if (graphDirection !== undefined) {
							onPatchView({ graphDirection });
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
			<Row title={settingsCopy.ticketFilter} hint={settingsCopy.ticketHint}>
				<span />
			</Row>
			{laneStates.map((state) => (
				<LaneAgeRow
					key={state}
					state={state}
					shown={shown}
					view={view}
					onPatchView={onPatchView}
				/>
			))}
			<Row
				title={settingsCopy.needsYouOnly}
				hint={settingsCopy.needsYouOnlyHint}
			>
				<Switch
					id="needs-you-only"
					checked={view.needsYouOnly}
					label={settingsCopy.needsYouOnly}
					onChange={(next) => onPatchView({ needsYouOnly: next })}
				/>
			</Row>
			<Row title={settingsCopy.blockedOnly} hint={settingsCopy.blockedOnlyHint}>
				<Switch
					id="blocked-only"
					checked={view.blockedOnly}
					label={settingsCopy.blockedOnly}
					onChange={(next) => onPatchView({ blockedOnly: next })}
				/>
			</Row>
		</section>
	);
}

export function ReviewSection({
	draft,
	onChange,
}: {
	draft: Configuration;
	onChange: (next: Partial<Configuration>) => void;
}) {
	return (
		<section id="review" className={clsx(fields.card)}>
			<h2 className={clsx(fields.cardTitle)}>{settingsSection.review}</h2>
			<Row title={settingsCopy.labels} hint={settingsCopy.labelsHint}>
				<Chips
					id="needs-you-labels"
					values={draft.needsYouLabels}
					placeholder={settingsCopy.addLabel}
					onChange={(needsYouLabels) => onChange({ needsYouLabels })}
				/>
			</Row>
			<Row title={settingsCopy.logins} hint={settingsCopy.loginsHint}>
				<Chips
					id="viewer-logins"
					values={draft.viewerLogins}
					placeholder={settingsCopy.addLogin}
					onChange={(viewerLogins) => onChange({ viewerLogins })}
				/>
			</Row>
			<Row title={settingsCopy.laneMappings} hint={settingsCopy.laneHint}>
				<MappingEditor
					mappings={draft.laneMappings}
					onChange={(laneMappings) => onChange({ laneMappings })}
				/>
			</Row>
			<Row title={settingsCopy.autoMerge} hint={settingsCopy.autoMergeHint}>
				<AutoMergeEditor
					overrides={draft.autoMerge}
					onChange={(autoMerge) => onChange({ autoMerge })}
				/>
			</Row>
		</section>
	);
}

export function NotificationsSection({
	draft,
	permission,
	onChange,
}: {
	draft: Configuration;
	permission: string;
	onChange: (next: Partial<Configuration>) => void;
}) {
	return (
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
						onChange({
							notificationTriggers: {
								...draft.notificationTriggers,
								needsYou,
							},
						})
					}
				/>
			</Row>
			<Row title={settingsCopy.newComment} hint={settingsCopy.newCommentHint}>
				<Switch
					id="trigger-comment"
					checked={draft.notificationTriggers.comment}
					label={settingsCopy.newComment}
					onChange={(comment) =>
						onChange({
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
						onChange({
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
	);
}

export function TrackersSection({ trackers }: { trackers: Trackers }) {
	return (
		<section id="trackers" className={clsx(fields.card)}>
			<h2 className={clsx(fields.cardTitle)}>{settingsSection.trackers}</h2>
			<p className={clsx(fields.hint)}>{settingsCopy.trackersLead}</p>
			<Row title={settingsCopy.github} hint={settingsCopy.githubHint}>
				<Credential id="github-status" present={trackers.github} />
			</Row>
			<Row title={settingsCopy.linear} hint={settingsCopy.linearHint}>
				<Credential id="linear-status" present={trackers.linear} />
			</Row>
		</section>
	);
}

export function SettingsBar({
	dirty,
	message,
	failed,
	onDiscard,
	onSave,
}: {
	dirty: boolean;
	message: string | null;
	failed: boolean;
	onDiscard: () => void;
	onSave: () => void;
}) {
	return (
		<div className={clsx(fields.bar)}>
			<SettingsToast message={message} failed={failed} />
			<button
				id="discard-settings"
				type="button"
				className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
				disabled={!dirty}
				onClick={onDiscard}
			>
				{settingsCopy.discard}
			</button>
			<button
				id="save-settings"
				type="button"
				className={clsx(fields.save, shell.buttonFocus)}
				disabled={!dirty}
				onClick={onSave}
			>
				{settingsCopy.save}
			</button>
		</div>
	);
}

function SettingsToast({
	message,
	failed,
}: {
	message: string | null;
	failed: boolean;
}) {
	if (message === null) {
		return null;
	}
	return (
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
	);
}
