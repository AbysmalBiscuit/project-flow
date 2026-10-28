import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";

import type { ParameterValue, RunSettings as Settings } from "./domain.ts";
import { Loading } from "./loading.tsx";
import { RunFact } from "./panel-sections.tsx";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { NotServed } from "./run-checkpoint.tsx";
import {
	choiceModeLabel,
	defaultChoiceLabel,
	noChoicesLabel,
	noParametersLabel,
	noRunDataLabel,
	runOptionLabel,
	runSettingsLabel,
	runTabData,
	yesNoLabel,
} from "./terms.ts";
import { colours, font, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	mono: {
		fontFamily: font.mono,
		overflowWrap: "anywhere",
	},
	soft: {
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	error: {
		color: colours.danger,
	},
});

function Mono({ value }: { value: string }) {
	return <span className={clsx(styles.mono)}>{value}</span>;
}

function parameterText(value: ParameterValue): string {
	return typeof value === "string" ? value : JSON.stringify(value);
}

function Choice({ choice }: { choice: Settings["choices"][number] }) {
	if (choice.error !== null) {
		return <span className={clsx(styles.error)}>{choice.error}</span>;
	}
	const picked = [choice.harness, choice.model, choice.effort].map(
		(part) => part ?? defaultChoiceLabel,
	);
	return (
		<>
			<Mono value={picked.join(" / ")} />{" "}
			<span className={clsx(styles.soft)}>
				{choiceModeLabel(choice.mode, choice.launcher)}
			</span>
		</>
	);
}

/** What a run was asked to do: its workflow package and parameters, the choice of each agent node, and its request options. */
export function RunSettings({
	run,
}: {
	run: Parameters<typeof pageQuery.runSettings>[0];
}) {
	const { data } = useQuery(pageQuery.runSettings(run));
	if (data === undefined) {
		return <Loading />;
	}
	if (data === "not served") {
		return <NotServed data={runTabData.settings} />;
	}
	if (data === "missing") {
		return <p className={clsx(panel.note)}>{noRunDataLabel}</p>;
	}
	const { options } = data;
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>
				{runSettingsLabel.parameters}
			</h3>
			{data.parametersError === null ? null : (
				<p className={clsx(panel.note, styles.error)}>{data.parametersError}</p>
			)}
			{data.parameters.length === 0 ? (
				<p className={clsx(panel.note)}>{noParametersLabel}</p>
			) : (
				<dl className={clsx(panel.facts)} data-settings="parameters">
					{data.parameters.map((parameter) => (
						<RunFact key={parameter.name} label={parameter.name}>
							<Mono value={parameterText(parameter.value)} />
						</RunFact>
					))}
				</dl>
			)}
			<h3 className={clsx(panel.sectionLabel)}>{runSettingsLabel.choices}</h3>
			{data.choices.length === 0 ? (
				<p className={clsx(panel.note)}>{noChoicesLabel}</p>
			) : (
				<dl className={clsx(panel.facts)} data-settings="choices">
					{data.choices.map((choice) => (
						<RunFact key={choice.node} label={choice.node}>
							<Choice choice={choice} />
						</RunFact>
					))}
				</dl>
			)}
			<h3 className={clsx(panel.sectionLabel)}>{runSettingsLabel.options}</h3>
			<dl className={clsx(panel.facts)} data-settings="options">
				<RunFact label={runOptionLabel.workflow}>
					<Mono value={data.workflowPackage} />
				</RunFact>
				<RunFact label={runOptionLabel.repo}>
					<Mono value={options.repo} />
				</RunFact>
				<RunFact label={runOptionLabel.ticket}>{options.ticket}</RunFact>
				<RunFact label={runOptionLabel.author}>{options.author}</RunFact>
				<RunFact label={runOptionLabel.keepWorktree}>
					{yesNoLabel[`${options.keepWorktree}`]}
				</RunFact>
				<RunFact label={runOptionLabel.sent}>
					{yesNoLabel[`${options.sent}`]}
				</RunFact>
				{options.source === null ? null : (
					<RunFact label={runOptionLabel.source}>{options.source}</RunFact>
				)}
				{options.rule === null ? null : (
					<RunFact label={runOptionLabel.rule}>{options.rule}</RunFact>
				)}
			</dl>
		</>
	);
}
