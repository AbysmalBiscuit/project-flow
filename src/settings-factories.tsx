import { useState } from "react";

import { Button } from "./button.tsx";
import type { Configuration, Factory } from "./configuration.ts";
import type { FactoryEntry } from "./factories.ts";
import { Row } from "./settings-parts.tsx";
import { settings as fields } from "./settings-styles.ts";
import {
	alsoReadThroughHub,
	boxCount,
	factoryCopy,
	settingsCopy,
	settingsSection,
} from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { clsx } from "./ui.ts";

function detail(factory: Factory, entry: FactoryEntry | undefined): string {
	const kind =
		entry?.kind === "hub"
			? [
					factoryCopy.hub,
					...(entry.boxes === null ? [] : [boxCount(entry.boxes)]),
				]
			: entry?.kind === "daemon"
				? [factoryCopy.daemon]
				: [];
	const source =
		entry?.source === "flag" ? factoryCopy.flag : factoryCopy.config;
	const ready = [
		...(factory.readyLabel === undefined
			? []
			: [factoryCopy.readyLabelOf(factory.readyLabel)]),
		...(factory.readyStatus === undefined
			? []
			: [factoryCopy.readyStatusOf(factory.readyStatus)]),
	];
	return [factory.url, source, ...kind, ...ready].join(", ");
}

function Reach({ id, entry }: { id: string; entry: FactoryEntry | undefined }) {
	return (
		<span
			id={id}
			className={clsx(
				fields.status,
				entry?.reachable === true && fields.statusOn,
			)}
		>
			{entry === undefined || entry.reachable === null
				? factoryCopy.unchecked
				: entry.reachable
					? factoryCopy.reachable
					: factoryCopy.unreachable}
		</span>
	);
}

function Duplicate({ entry }: { entry: FactoryEntry | undefined }) {
	return entry?.alsoReadThroughHub === undefined ? null : (
		<span className={clsx(fields.warning)}>
			{alsoReadThroughHub(entry.alsoReadThroughHub)}
		</span>
	);
}

export function FactoriesSection({
	draft,
	entries,
	onChange,
}: {
	draft: Configuration;
	entries: FactoryEntry[];
	onChange: (next: Partial<Configuration>) => void;
}) {
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [readyLabel, setReadyLabel] = useState("");
	const flagged = entries.filter((entry) => entry.source === "flag");
	const configured = (factory: Factory) =>
		flagged.length > 0
			? undefined
			: entries.find((entry) => entry.url === factory.url);
	function add(): void {
		const next = { name: name.trim(), url: url.trim() };
		if (next.name === "" || next.url === "") {
			return;
		}
		const known = draft.factories.find((factory) => factory.url === next.url);
		const kept = readyLabel.trim() || known?.readyLabel;
		onChange({
			factories: [
				...draft.factories.filter((factory) => factory.url !== next.url),
				{
					...next,
					...(kept === undefined ? {} : { readyLabel: kept }),
					...(known?.readyStatus === undefined
						? {}
						: { readyStatus: known.readyStatus }),
				},
			],
		});
		setName("");
		setUrl("");
		setReadyLabel("");
	}
	return (
		<section id="factories" className={clsx(fields.card)}>
			<h2 className={clsx(fields.cardTitle)}>{settingsSection.factories}</h2>
			<p className={clsx(fields.hint)}>
				{flagged.length > 0 ? factoryCopy.flagLead : factoryCopy.lead}
			</p>
			<p className={clsx(fields.hint)}>{factoryCopy.runStartLead}</p>
			{flagged.map((entry, index) => (
				<Row key={entry.url} title={entry.name} hint={detail(entry, entry)}>
					<span className={clsx(fields.chips)}>
						<Duplicate entry={entry} />
						<Reach id={`factory-flag-${index}`} entry={entry} />
					</span>
				</Row>
			))}
			{draft.factories.length === 0 && flagged.length === 0 ? (
				<p className={clsx(fields.hint)}>{factoryCopy.none}</p>
			) : null}
			{draft.factories.map((factory, index) => (
				<Row
					key={factory.url}
					title={factory.name}
					hint={detail(factory, configured(factory))}
				>
					<span className={clsx(fields.chips)}>
						{flagged.length > 0 ? (
							<span className={clsx(fields.status)}>{factoryCopy.notRead}</span>
						) : (
							<>
								<Duplicate entry={configured(factory)} />
								<Reach id={`factory-${index}`} entry={configured(factory)} />
							</>
						)}
						<Button
							id={`factory-${index}-remove`}
							icon="x"
							label={`Remove ${factory.name}`}
							onClick={() =>
								onChange({
									factories: draft.factories.filter(
										(item) => item.url !== factory.url,
									),
								})
							}
						/>
					</span>
				</Row>
			))}
			<div className={clsx(fields.row)}>
				<span className={clsx(fields.chips)}>
					<TextInput
						id="factory-name"
						width={fields.chipInput}
						aria-label={factoryCopy.name}
						placeholder={factoryCopy.name}
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
					<TextInput
						id="factory-url"
						aria-label={factoryCopy.url}
						placeholder={factoryCopy.url}
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") {
								return;
							}
							event.preventDefault();
							add();
						}}
					/>
					<TextInput
						id="factory-ready-label"
						width={fields.chipInput}
						aria-label={factoryCopy.readyLabel}
						placeholder={factoryCopy.readyLabel}
						value={readyLabel}
						onChange={(event) => setReadyLabel(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") {
								return;
							}
							event.preventDefault();
							add();
						}}
					/>
					<Button id="factory-add" label={settingsCopy.add} onClick={add} />
				</span>
			</div>
		</section>
	);
}
