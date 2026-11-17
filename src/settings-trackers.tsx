import { backendRows } from "./backend-labels.ts";
import type { Configuration } from "./configuration.ts";
import type { BackendViews, TrackerKind } from "./domain.ts";
import { trackerKinds } from "./domain.ts";
import { Select } from "./select.tsx";
import { Credential } from "./settings-parts.tsx";
import { settings as fields } from "./settings-styles.ts";
import { settingsCopy, settingsSection } from "./settings-terms.ts";
import { TextInput } from "./text-input.tsx";
import { clsx } from "./ui.ts";

type DopplerTokens = Configuration["dopplerTokens"];
type DopplerSecret = NonNullable<DopplerTokens[TrackerKind]>;

const origins = ["environment", "doppler"] as const;

function isTracker(kind: string): kind is TrackerKind {
	return trackerKinds.some((tracker) => tracker === kind);
}

export function TrackersSection({
	backends,
	discoveryErrors,
	draft,
	saved,
	onChange,
}: {
	backends: BackendViews;
	discoveryErrors: string[];
	draft: DopplerTokens;
	saved: DopplerTokens;
	onChange: (next: Pick<Configuration, "dopplerTokens">) => void;
}) {
	const set = (kind: TrackerKind, secret: DopplerSecret | undefined) => {
		const { [kind]: _dropped, ...rest } = draft;
		onChange({
			dopplerTokens: secret === undefined ? rest : { ...rest, [kind]: secret },
		});
	};
	const restart = JSON.stringify(draft) !== JSON.stringify(saved);
	return (
		<section id="trackers" className={clsx(fields.card)}>
			<h2 className={clsx(fields.cardTitle)}>{settingsSection.trackers}</h2>
			<p className={clsx(fields.hint)}>{settingsCopy.trackersLead}</p>
			{restart ? (
				<p className={clsx(fields.warning)}>{settingsCopy.nextStart}</p>
			) : null}
			{discoveryErrors.map((error) => (
				<p key={error} className={clsx(fields.warning)}>
					{error}
				</p>
			))}
			{backendRows(backends).map((backend) => {
				const kind = backend.kind;
				const tokenEnv = backend.tokenEnv;
				const secret = isTracker(kind) ? draft[kind] : undefined;
				return (
					<div key={kind} className={clsx(fields.trackerRow)}>
						<div className={clsx(fields.row)}>
							<div className={clsx(fields.rowText)}>
								<span className={clsx(fields.rowTitle)}>{backend.label}</span>
								<span className={clsx(fields.hint)}>
									{secret === undefined
										? backend.hint
										: settingsCopy.fromDoppler(secret)}
								</span>
							</div>
							<span className={clsx(fields.chips)}>
								<Credential
									id={`${kind}-status`}
									present={backend.credential === "present"}
								/>
								{tokenEnv === undefined || !isTracker(kind) ? null : (
									<Select
										id={`${kind}-token-from`}
										aria-label={settingsCopy.tokenFromOf(backend.label)}
										value={secret === undefined ? "environment" : "doppler"}
										options={origins.map((origin) => ({
											value: origin,
											label: settingsCopy.tokenFrom[origin],
										}))}
										onChange={(origin) =>
											set(
												kind,
												origin === "doppler"
													? { project: "", config: "", secret: tokenEnv }
													: undefined,
											)
										}
									/>
								)}
							</span>
						</div>
						{secret === undefined || !isTracker(kind) ? null : (
							<div className={clsx(fields.dopplerFields)}>
								{(["project", "config", "secret"] as const).map((field) => (
									<span key={field} className={clsx(fields.dopplerField)}>
										<span className={clsx(fields.hint)} aria-hidden="true">
											{settingsCopy.dopplerField[field]}
										</span>
										<TextInput
											id={`${kind}-doppler-${field}`}
											aria-label={`${backend.label} ${settingsCopy.dopplerField[field]}`}
											value={secret[field]}
											onChange={(event) =>
												set(kind, { ...secret, [field]: event.target.value })
											}
										/>
									</span>
								))}
							</div>
						)}
					</div>
				);
			})}
		</section>
	);
}
