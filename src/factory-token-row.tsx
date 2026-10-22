import type { Configuration } from "./configuration.ts";
import { settingsCopy } from "./terms.ts";
import { clsx } from "./ui.ts";
import { settings as fields } from "./ui-styles.ts";

const pollChoices = [30, 60, 300, 600] as const;

function pollLabel(seconds: number): string {
	if (seconds % 60 === 0) {
		const minutes = seconds / 60;
		return minutes === 1 ? "1 minute" : `${minutes} minutes`;
	}
	return `${seconds} seconds`;
}

export function FactoryTokenRow({
	checked,
	onChange,
}: {
	checked: boolean;
	onChange: (patch: Pick<Configuration, "factoryGithubTokens">) => void;
}) {
	return (
		<div className={clsx(fields.row)}>
			<div className={clsx(fields.rowText)}>
				<span className={clsx(fields.rowTitle)}>
					{settingsCopy.factoryTokens}
				</span>
				<span className={clsx(fields.hint)}>
					{settingsCopy.factoryTokensHint}
				</span>
			</div>
			<button
				id="factory-github-tokens"
				type="button"
				role="switch"
				aria-checked={checked}
				aria-label={settingsCopy.factoryTokens}
				className={clsx(fields.switch, checked && fields.switchOn)}
				onClick={() => onChange({ factoryGithubTokens: !checked })}
			>
				<span className={clsx(fields.knob, checked && fields.knobOn)} />
			</button>
		</div>
	);
}

export function PollIntervalRow({
	seconds,
	onChange,
}: {
	seconds: number;
	onChange: (patch: Pick<Configuration, "pollIntervalSeconds">) => void;
}) {
	const known = pollChoices.find((choice) => choice === seconds) !== undefined;
	return (
		<div className={clsx(fields.row)}>
			<div className={clsx(fields.rowText)}>
				<span className={clsx(fields.rowTitle)}>
					{settingsCopy.pollInterval}
				</span>
				<span className={clsx(fields.hint)}>{settingsCopy.pollHint}</span>
			</div>
			<select
				id="poll-interval"
				className={clsx(fields.select)}
				value={String(seconds)}
				onChange={(event) =>
					onChange({ pollIntervalSeconds: Number(event.target.value) })
				}
			>
				{pollChoices.map((choice) => (
					<option key={choice} value={choice}>
						{pollLabel(choice)}
					</option>
				))}
				{known ? null : <option value={seconds}>{pollLabel(seconds)}</option>}
			</select>
		</div>
	);
}
