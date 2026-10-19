import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Configuration } from "./configuration.ts";
import { type KnownBot, knownBots } from "./domain.ts";
import { navLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { settings as fields, shell } from "./ui-styles.ts";

type ProjectRef = Configuration["pinned"][number];
function refLine(ref: ProjectRef): string {
	if (ref.tracker === "linear") {
		return `linear ${ref.project}`;
	}
	if ("repo" in ref) {
		return `github ${ref.repo}`;
	}
	return `github-project ${ref.owner} ${ref.project}`;
}

function parseRefs(text: string): ProjectRef[] {
	return lines(text).map((line) => {
		const [kind, first, second] = line.split(/\s+/);
		if (kind === "linear" && first !== undefined) {
			return { tracker: "linear", project: first };
		}
		if (kind === "github" && first !== undefined) {
			return { tracker: "github", repo: first };
		}
		if (
			kind === "github-project" &&
			first !== undefined &&
			second !== undefined
		) {
			return { tracker: "github", owner: first, project: Number(second) };
		}
		throw new Error(`project line: ${line}`);
	});
}

function lines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

function botLines(bots: Record<string, string[]> | undefined): string {
	return Object.entries(bots ?? {})
		.map(([repo, names]) => `${repo} ${names.join(" ")}`)
		.join("\n");
}

function knownBot(name: string): name is KnownBot {
	return knownBots.some((bot) => bot === name);
}

function parseBots(text: string): Record<string, KnownBot[]> {
	const bots: Record<string, KnownBot[]> = {};
	for (const line of lines(text)) {
		const [repo, ...names] = line.split(/\s+/);
		if (repo === undefined) {
			continue;
		}
		const parsed: KnownBot[] = [];
		for (const name of names) {
			if (!knownBot(name)) {
				throw new Error(`bot: ${name}`);
			}
			parsed.push(name);
		}
		bots[repo] = parsed;
	}
	return bots;
}

function pmBotLines(pmBot: Record<string, boolean>): string {
	return Object.entries(pmBot)
		.map(([name, value]) => `${name} ${value ? "true" : "false"}`)
		.join("\n");
}

function parsePmBot(text: string): Record<string, boolean> {
	const pmBot: Record<string, boolean> = {};
	for (const line of lines(text)) {
		const [name, value] = line.split(/\s+/);
		if (name === undefined || (value !== "true" && value !== "false")) {
			throw new Error(`pm bot: ${line}`);
		}
		pmBot[name] = value === "true";
	}
	return pmBot;
}

function Menu({
	settings,
	onSave,
}: {
	settings: Configuration;
	onSave: (next: Configuration) => Promise<string | null>;
}) {
	const [pinned, setPinned] = useState(settings.pinned.map(refLine).join("\n"));
	const [hidden, setHidden] = useState(settings.hidden.map(refLine).join("\n"));
	const [activityWindowDays, setActivityWindowDays] = useState(
		String(settings.activityWindowDays),
	);
	const [pollIntervalSeconds, setPollIntervalSeconds] = useState(
		String(settings.pollIntervalSeconds),
	);
	const [expectedBots, setExpectedBots] = useState(
		botLines(settings.expectedBots),
	);
	const [pmBot, setPmBot] = useState(pmBotLines(settings.pmBot));
	const [needsYouLabels, setNeedsYouLabels] = useState(
		settings.needsYouLabels.join("\n"),
	);
	const [checkoutRoots, setCheckoutRoots] = useState(
		settings.checkoutRoots.join("\n"),
	);
	const [viewerLogins, setViewerLogins] = useState(
		settings.viewerLogins.join("\n"),
	);
	const [needsYou, setNeedsYou] = useState(
		settings.notificationTriggers.needsYou,
	);
	const [comment, setComment] = useState(settings.notificationTriggers.comment);
	const [blockerCleared, setBlockerCleared] = useState(
		settings.notificationTriggers.blockerCleared,
	);
	const [message, setMessage] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);

	return (
		<main className={clsx(shell.page)}>
			<p className={clsx(shell.nav)}>
				<a className={clsx(shell.link, shell.linkFocus)} href="/">
					{navLabel.projects}
				</a>
				<button
					type="button"
					className={clsx(
						shell.button,
						shell.buttonHover,
						shell.buttonFocus,
						shell.theme,
					)}
					data-theme-toggle=""
				>
					Dark mode
				</button>
			</p>
			<h1 className={clsx(shell.title)}>{navLabel.settings}</h1>
			<label className={clsx(fields.field)}>
				Pinned projects
				<textarea
					id="pinned"
					className={clsx(fields.refs)}
					value={pinned}
					onChange={(event) => setPinned(event.target.value)}
				/>
			</label>
			<label className={clsx(fields.field)}>
				Hidden projects
				<textarea
					id="hidden"
					className={clsx(fields.refs)}
					value={hidden}
					onChange={(event) => setHidden(event.target.value)}
				/>
			</label>
			<label className={clsx(fields.field)}>
				Activity window
				<input
					id="activity-window"
					className={clsx(fields.control)}
					inputMode="numeric"
					value={activityWindowDays}
					onChange={(event) => setActivityWindowDays(event.target.value)}
				/>
			</label>
			<label className={clsx(fields.field)}>
				Poll interval
				<input
					id="poll-interval"
					className={clsx(fields.control)}
					inputMode="numeric"
					value={pollIntervalSeconds}
					onChange={(event) => setPollIntervalSeconds(event.target.value)}
				/>
			</label>
			<label className={clsx(fields.field)}>
				Checkout roots
				<textarea
					id="checkout-roots"
					className={clsx(fields.refs)}
					value={checkoutRoots}
					onChange={(event) => setCheckoutRoots(event.target.value)}
				/>
			</label>
			<label className={clsx(fields.field)}>
				Expected bots
				<textarea
					id="expected-bots"
					className={clsx(fields.refs)}
					value={expectedBots}
					onChange={(event) => setExpectedBots(event.target.value)}
				/>
			</label>
			<p className={clsx(fields.note)}>Known bots: {knownBots.join(", ")}</p>
			<label className={clsx(fields.field)}>
				PM Bot
				<textarea
					id="pm-bot"
					className={clsx(fields.refs)}
					value={pmBot}
					onChange={(event) => setPmBot(event.target.value)}
				/>
			</label>
			<label className={clsx(fields.field)}>
				Viewer logins
				<textarea
					id="viewer-logins"
					className={clsx(fields.refs)}
					value={viewerLogins}
					onChange={(event) => setViewerLogins(event.target.value)}
				/>
			</label>
			<label className={clsx(fields.field)}>
				Need-human and need-engineer labels
				<textarea
					id="needs-you-labels"
					className={clsx(fields.refs)}
					value={needsYouLabels}
					onChange={(event) => setNeedsYouLabels(event.target.value)}
				/>
			</label>
			<fieldset className={clsx(fields.field)}>
				<legend>Notification triggers</legend>
				<label className={clsx(fields.choice)}>
					<input
						id="trigger-needs-you"
						type="checkbox"
						checked={needsYou}
						onChange={(event) => setNeedsYou(event.target.checked)}
					/>{" "}
					New needs-you item
				</label>
				<label className={clsx(fields.choice)}>
					<input
						id="trigger-comment"
						type="checkbox"
						checked={comment}
						onChange={(event) => setComment(event.target.checked)}
					/>{" "}
					New comment
				</label>
				<label className={clsx(fields.choice)}>
					<input
						id="trigger-blocker"
						type="checkbox"
						checked={blockerCleared}
						onChange={(event) => setBlockerCleared(event.target.checked)}
					/>{" "}
					Cleared cross-project blocker
				</label>
			</fieldset>
			<p>
				<button
					id="save-settings"
					type="button"
					className={clsx(shell.button, shell.buttonHover, shell.buttonFocus)}
					onClick={() => {
						void onSaveClick();
					}}
				>
					Save
				</button>
			</p>
			{message === null ? null : (
				<p
					id="settings-message"
					className={clsx(failed ? fields.error : fields.saved)}
				>
					{message}
				</p>
			)}
		</main>
	);

	async function onSaveClick(): Promise<void> {
		try {
			const next: Configuration = {
				...settings,
				pinned: parseRefs(pinned),
				hidden: parseRefs(hidden),
				activityWindowDays: Number(activityWindowDays),
				pollIntervalSeconds: Number(pollIntervalSeconds),
				checkoutRoots: lines(checkoutRoots),
				expectedBots: parseBots(expectedBots),
				viewerLogins: lines(viewerLogins),
				pmBot: parsePmBot(pmBot),
				needsYouLabels: lines(needsYouLabels),
				notificationTriggers: {
					needsYou,
					comment,
					blockerCleared,
				},
			};
			const error = await onSave(next);
			setFailed(error !== null);
			setMessage(error ?? "Saved");
		} catch (error) {
			setFailed(true);
			setMessage(error instanceof Error ? error.message : "save failed");
		}
		requestAnimationFrame(() => {
			document
				.getElementById("settings-message")
				?.scrollIntoView({ block: "end" });
		});
	}
}

function Page() {
	const [settings, setSettings] = useState<Configuration | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let stopped = false;
		fetch("/api/settings")
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`settings failed (HTTP ${response.status})`);
				}
				return (await response.json()) as Configuration;
			})
			.then((body) => {
				if (!stopped) {
					setSettings(body);
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
		return <main className={clsx(shell.page)}>{error}</main>;
	}
	if (settings === null) {
		return <main className={clsx(shell.page)}>Loading settings</main>;
	}
	return (
		<Menu
			settings={settings}
			onSave={async (next) => {
				const response = await fetch("/api/settings", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(next),
				});
				const body: unknown = await response.json().catch(() => null);
				if (!response.ok) {
					const message =
						body !== null &&
						typeof body === "object" &&
						"error" in body &&
						typeof body.error === "string"
							? body.error
							: `save failed (HTTP ${response.status})`;
					return message;
				}
				if (body === null) {
					throw new Error("save failed");
				}
				setSettings(body as Configuration);
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
