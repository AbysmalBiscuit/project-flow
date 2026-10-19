import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { knownBots } from "./domain.ts";
import styles from "./settings.module.css";
import shell from "./shell.module.css";

type ProjectRef =
	| { tracker: "github"; repo: string }
	| { tracker: "github"; owner: string; project: number }
	| { tracker: "linear"; project: string };

type Settings = {
	pinned: ProjectRef[];
	hidden: ProjectRef[];
	activityWindowDays: number;
	pollIntervalSeconds: number;
	checkoutRoots: string[];
	expectedBots?: Record<string, string[]>;
	noSenior: Record<string, boolean>;
	needsYouLabels: string[];
	viewerLogins: string[];
	notificationTriggers: {
		needsYou: boolean;
		comment: boolean;
		blockerCleared: boolean;
	};
};

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
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.map((line) => {
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

function parseBots(text: string): Record<string, string[]> {
	const bots: Record<string, string[]> = {};
	for (const line of lines(text)) {
		const [repo, ...names] = line.split(/\s+/);
		if (repo === undefined) {
			continue;
		}
		bots[repo] = names;
	}
	return bots;
}

function seniorLines(noSenior: Record<string, boolean>): string {
	return Object.entries(noSenior)
		.filter(([, value]) => value)
		.map(([name]) => name)
		.join("\n");
}

function Menu({
	settings,
	onSave,
}: {
	settings: Settings;
	onSave: (next: Settings) => Promise<string | null>;
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
	const [noSenior, setNoSenior] = useState(seniorLines(settings.noSenior));
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
		<main className={shell.page}>
			<p className={shell.nav}>
				<a className={shell.link} href="/">
					Projects
				</a>
				<button
					type="button"
					className={`${shell.button} ${shell.theme}`}
					data-theme-toggle=""
				>
					Dark mode
				</button>
			</p>
			<h1 className={shell.title}>Settings</h1>
			<label className={styles.field}>
				Pinned projects
				<textarea
					id="pinned"
					className={styles.refs}
					value={pinned}
					onChange={(event) => setPinned(event.target.value)}
				/>
			</label>
			<label className={styles.field}>
				Hidden projects
				<textarea
					id="hidden"
					className={styles.refs}
					value={hidden}
					onChange={(event) => setHidden(event.target.value)}
				/>
			</label>
			<label className={styles.field}>
				Activity window
				<input
					id="activity-window"
					className={styles.control}
					inputMode="numeric"
					value={activityWindowDays}
					onChange={(event) => setActivityWindowDays(event.target.value)}
				/>
			</label>
			<label className={styles.field}>
				Poll interval
				<input
					id="poll-interval"
					className={styles.control}
					inputMode="numeric"
					value={pollIntervalSeconds}
					onChange={(event) => setPollIntervalSeconds(event.target.value)}
				/>
			</label>
			<label className={styles.field}>
				Checkout roots
				<textarea
					id="checkout-roots"
					className={styles.refs}
					value={checkoutRoots}
					onChange={(event) => setCheckoutRoots(event.target.value)}
				/>
			</label>
			<label className={styles.field}>
				Expected bots
				<textarea
					id="expected-bots"
					className={styles.refs}
					value={expectedBots}
					onChange={(event) => setExpectedBots(event.target.value)}
				/>
			</label>
			<p className={styles.note}>Known bots: {knownBots.join(", ")}</p>
			<label className={styles.field}>
				No senior
				<textarea
					id="no-senior"
					className={styles.refs}
					value={noSenior}
					onChange={(event) => setNoSenior(event.target.value)}
				/>
			</label>
			<label className={styles.field}>
				Viewer logins
				<textarea
					id="viewer-logins"
					className={styles.refs}
					value={viewerLogins}
					onChange={(event) => setViewerLogins(event.target.value)}
				/>
			</label>
			<label className={styles.field}>
				Need-human and need-engineer labels
				<textarea
					id="needs-you-labels"
					className={styles.refs}
					value={needsYouLabels}
					onChange={(event) => setNeedsYouLabels(event.target.value)}
				/>
			</label>
			<fieldset className={styles.triggers}>
				<legend>Notification triggers</legend>
				<label className={styles.choice}>
					<input
						id="trigger-needs-you"
						type="checkbox"
						checked={needsYou}
						onChange={(event) => setNeedsYou(event.target.checked)}
					/>{" "}
					New needs-you item
				</label>
				<label className={styles.choice}>
					<input
						id="trigger-comment"
						type="checkbox"
						checked={comment}
						onChange={(event) => setComment(event.target.checked)}
					/>{" "}
					New comment
				</label>
				<label className={styles.choice}>
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
					className={shell.button}
					onClick={() => {
						void (async () => {
							let next: Settings;
							try {
								next = {
									...settings,
									pinned: parseRefs(pinned),
									hidden: parseRefs(hidden),
									activityWindowDays: Number(activityWindowDays),
									pollIntervalSeconds: Number(pollIntervalSeconds),
									checkoutRoots: lines(checkoutRoots),
									expectedBots: parseBots(expectedBots),
									viewerLogins: lines(viewerLogins),
									noSenior: Object.fromEntries(
										lines(noSenior).map((name) => [name, true]),
									),
									needsYouLabels: lines(needsYouLabels),
									notificationTriggers: {
										needsYou,
										comment,
										blockerCleared,
									},
								};
							} catch (error) {
								setFailed(true);
								setMessage(
									error instanceof Error ? error.message : "invalid settings",
								);
								return;
							}
							const error = await onSave(next);
							setFailed(error !== null);
							setMessage(error ?? "Saved");
							requestAnimationFrame(() => {
								document
									.getElementById("settings-message")
									?.scrollIntoView({ block: "end" });
							});
						})();
					}}
				>
					Save
				</button>
			</p>
			{message === null ? null : (
				<p
					id="settings-message"
					className={failed ? styles.error : styles.saved}
				>
					{message}
				</p>
			)}
		</main>
	);
}

function Page() {
	const [settings, setSettings] = useState<Settings | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		let stopped = false;
		fetch("/api/settings")
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`settings failed (HTTP ${response.status})`);
				}
				return (await response.json()) as Settings;
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
		return <main className={shell.page}>{error}</main>;
	}
	if (settings === null) {
		return <main className={shell.page}>Loading settings</main>;
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
				if (!response.ok) {
					const body = (await response.json()) as { error?: string };
					return body.error ?? `save failed (HTTP ${response.status})`;
				}
				setSettings((await response.json()) as Settings);
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
