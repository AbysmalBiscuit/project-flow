import type { Configuration } from "./configuration.ts";
import type { FactoryTokenReport } from "./factory-tokens.ts";
import { Select } from "./select.tsx";
import { Switch } from "./settings-parts.tsx";
import { settings as fields } from "./settings-styles.ts";
import { factoryTokenFallbackLabel, settingsCopy } from "./terms.ts";
import { clsx } from "./ui.ts";

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
	reports,
	onChange,
}: {
	checked: boolean;
	reports: FactoryTokenReport[];
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
				{reports.map((report) => (
					<span
						key={report.cause === "mint failed" ? report.cause : report.owner}
						className={clsx(fields.warning)}
						data-factory-token-report={
							report.cause === "mint failed" ? "mint" : report.owner
						}
					>
						{factoryTokenFallbackLabel(report)}
					</span>
				))}
			</div>
			<Switch
				id="factory-github-tokens"
				checked={checked}
				label={settingsCopy.factoryTokens}
				onChange={(next) => onChange({ factoryGithubTokens: next })}
			/>
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
			<Select
				id="poll-interval"
				value={seconds}
				options={[...pollChoices, ...(known ? [] : [seconds])].map(
					(choice) => ({ value: choice, label: pollLabel(choice) }),
				)}
				onChange={(choice) => onChange({ pollIntervalSeconds: choice })}
			/>
		</div>
	);
}
