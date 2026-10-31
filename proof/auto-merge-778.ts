import { parseConfiguration } from "../src/configuration.ts";
import type { PullRequest } from "../src/domain.ts";
import { memoryNotifier } from "../src/notifier.ts";
import { poll, type PollOptions } from "../src/poll.ts";
import type { Forge, Tracker } from "../src/ports.ts";
import { mergesOnItsOwn } from "../src/review.ts";
import { sqliteStore } from "../src/store.ts";

// The HTTP seam reaches one forge, so the poll runs here with two forges that
// hold one repo name and give different auto-merge settings.
const repo = "acme/widget";
const declared = "git.acme.dev";

const pullOf = (number: number, url: string): PullRequest => ({
	repo,
	number,
	url,
	title: url,
	draft: false,
	branch: "main",
	body: "",
	closingKeys: [],
	headSha: "",
	headCommittedAt: null,
	merged: false,
	checks: [],
	comments: [],
	reviews: [],
	reactions: [],
});

const asked: string[] = [];

const forgeOf = (host: string, setting: boolean, number: number): Forge => ({
	listPulls: async () => [],
	listLinkedPulls: async () => [pullOf(number, `https://${host}/${repo}`)],
	listBranches: async () => [],
	repoAutoMerge: async (name) => {
		asked.push(`${host} ${name}`);
		return setting;
	},
	pullOfUrl: () => ({ repo, number }),
});

const home = forgeOf("github.com", true, 1);
const hosted = forgeOf(declared, false, 2);
const forges = new Map([
	["github.com", home],
	[declared, hosted],
]);

const tracker: Tracker = {
	findProjects: async () => ({ projects: [], viewer: null }),
	listTickets: async () => ({ name: "Launch", tickets: [] }),
	pullRefs: async () => [
		{ url: `https://github.com/${repo}/pull/1`, ticketKey: "WID-1" },
		{ url: `https://${declared}/${repo}/pull/2`, ticketKey: "WID-2" },
	],
};

const configuration = parseConfiguration(
	JSON.stringify({
		checkoutRoots: [],
		tracked: [{ tracker: "linear", project: "launch" }],
	}),
);
const opened = sqliteStore(":memory:");
const options: PollOptions = {
	configuration: {
		read: async () => configuration,
		write: async () => configuration,
	},
	backends: {
		trackers: new Map([["linear", tracker]]),
		forges,
		views: { trackers: [], forges: [] },
		readerOf: () => ({ tracker }),
		forgeLabelOf: () => undefined,
		forgeOf: () => null,
		declaredHostOf: (forge) => (forge === hosted ? declared : undefined),
		explains: () => false,
	},
	store: opened.store,
	clock: { now: () => new Date("2026-04-01T12:00:00.000Z") },
	notifier: memoryNotifier(),
	listTodos: undefined,
	listCheckouts: undefined,
	releaseDiscovery: () => {},
	fallback: configuration,
	fullPoll: new Set(),
	lastFullPollAt: new Map(),
	projectReads: { count: 0, newest: new Map() },
	holdLists: Promise.resolve(),
	viewers: [],
	runs: [],
	factoryRuns: () => [],
	listedFactories: () => [],
	linearSources: () => [],
	runStartRequests: new Map(),
	workcellAuto: {},
	repoAutoMerge: {},
	attention: {
		needsYou: [],
		comments: new Map(),
		blockers: new Map(),
		closed: new Set(),
		closedBlockers: new Set(),
	},
	seenNotifications: new Set(),
	primed: false,
	polling: false,
	progress: null,
	stopped: false,
	catalogue: [],
	mayPublish: () => true,
	factoryUnreachable: () => false,
};

await poll(options);

const pulls = opened.store.readTickets().flatMap((row) => row.pulls);
const merges = pulls.map((pull) => ({
	url: pull.url,
	mergesAlone: mergesOnItsOwn(
		[pull],
		"Launch",
		"launch",
		{
			config: {},
			workcell: {},
			repo: options.repoAutoMerge,
			projectHost: undefined,
		},
		new Set(),
	),
}));
opened.close();

console.log(JSON.stringify({ asked, values: options.repoAutoMerge, merges }));
const independent =
	asked.length === 2 &&
	merges.find((item) => item.url.includes("github.com"))?.mergesAlone ===
		true &&
	merges.find((item) => item.url.includes(declared))?.mergesAlone === false;
console.log(independent ? "independent" : "shared");
process.exit(independent ? 0 : 1);
