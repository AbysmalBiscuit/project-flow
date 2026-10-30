import { Button } from "./button.tsx";
import type { Configuration, UserState } from "./configuration.ts";
import { control } from "./control-styles.ts";
import { Dropdown } from "./dropdown.tsx";
import { FactoryTokenRow, PollIntervalRow } from "./factory-token-row.tsx";
import type { FactoryTokenReport } from "./factory-tokens.ts";
import { Select } from "./select.tsx";
import {
	ageChoices,
	ageLabel,
	AutoMergeEditor,
	Chips,
	Credential,
	MappingEditor,
	openViewLabel,
	Row,
	sections,
	Switch,
	type Trackers,
} from "./settings-parts.tsx";
import { settings as fields } from "./settings-styles.ts";
import { tonedProps } from "./state-tone.ts";
import {
	graphDirectionLabel,
	navLabel,
	settingsCopy,
	settingsSection,
} from "./terms.ts";
import { clsx } from "./ui.ts";
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
						control.clear,
						control.focus,
						current === section.id && control.current,
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
	factoryTokenReports,
	onChange,
}: {
	theme: string;
	draft: Configuration;
	factoryTokenReports: FactoryTokenReport[];
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
			<Row
				title={settingsCopy.showNeedsYou}
				hint={settingsCopy.showNeedsYouHint}
			>
				<Switch
					id="show-needs-you"
					checked={draft.overview.showNeedsYou}
					label={settingsCopy.showNeedsYou}
					onChange={(showNeedsYou) =>
						onChange({ overview: { ...draft.overview, showNeedsYou } })
					}
				/>
			</Row>
			<FactoryTokenRow
				checked={draft.factoryGithubTokens}
				reports={factoryTokenReports}
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
	states,
	shown,
	view,
	onPatchView,
}: {
	state: UserState;
	states: readonly UserState[];
	shown: Set<string>;
	view: ViewDraft;
	onPatchView: (next: Partial<ViewDraft>) => void;
}) {
	const on = shown.has(state.label);
	const days = laneAgeCap(view.maxAgeDays, state.label, state.categories[0]);
	return (
		<div className={clsx(fields.row)}>
			<span className={clsx(fields.lane)}>
				<Switch
					id={`lane-${state.id}`}
					checked={on}
					label={state.label}
					onChange={(next) => {
						const names = states.flatMap((item) =>
							(item.id === state.id ? next : shown.has(item.label))
								? [item.label]
								: [],
						);
						onPatchView({ shownLanes: names });
					}}
				/>
				<span {...tonedProps(state.colour, undefined, fields.dot)} />
				{state.label}
			</span>
			<Select
				id={`age-${state.id}`}
				aria-label={`${state.label} age`}
				value={days}
				options={ageChoices.map((choice) => ({
					value: choice,
					label: ageLabel(choice),
				}))}
				onChange={(choice) =>
					onPatchView({
						maxAgeDays: {
							...view.maxAgeDays,
							[state.label]: choice,
						},
					})
				}
			/>
		</div>
	);
}

export function ProjectViewsSection({
	view,
	states,
	shown,
	onPatchView,
}: {
	view: ViewDraft;
	states: readonly UserState[];
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
				<Select
					id="graph-direction"
					value={view.graphDirection}
					options={graphDirections.map((item) => ({
						value: item,
						label: graphDirectionLabel[item],
					}))}
					onChange={(graphDirection) => onPatchView({ graphDirection })}
				/>
			</Row>
			<Row title={settingsCopy.ticketFilter} hint={settingsCopy.ticketHint}>
				<span />
			</Row>
			{states.map((state) => (
				<LaneAgeRow
					key={state.id}
					state={state}
					states={states}
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
	saving,
	onDiscard,
	onSave,
}: {
	dirty: boolean;
	saving: boolean;
	onDiscard: () => void;
	onSave: () => void;
}) {
	return (
		<div className={clsx(fields.bar)}>
			<Button
				id="discard-settings"
				label={settingsCopy.discard}
				disabled={!dirty || saving}
				onClick={onDiscard}
			/>
			<Button
				id="save-settings"
				label={settingsCopy.save}
				tone="primary"
				disabled={!dirty || saving}
				onClick={onSave}
			/>
		</div>
	);
}
