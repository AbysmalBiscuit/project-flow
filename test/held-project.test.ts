import { expect, test } from "bun:test";

import type { Fetch } from "../src/fetch.ts";
import {
	issuesResponse,
	listedRead,
	otherRepo,
	page,
	readOverview,
	recordedOrEmpty,
	repo,
	ticket,
	withServer,
} from "./live-support.ts";
import {
	recordedDiscovery,
	settledOverview,
	unrecorded,
	urlOf,
} from "./support.ts";

test("a ticket closed on GitHub shows as done while an earlier project read is still held", async () => {
	let releaseOther: () => void = () => {};
	const otherHeld = new Promise<void>((resolve) => {
		releaseOther = resolve;
	});
	let repoReads = 0;
	let otherReads = 0;
	const fetchImpl: Fetch = async (input, init) => {
		const discovered = recordedDiscovery(input, init);
		if (discovered !== null) {
			return discovered;
		}
		const url = urlOf(input);
		if (url === "https://api.github.com/user") {
			return new Response(JSON.stringify({ login: "lev" }), { status: 200 });
		}
		const listed = listedRead(input, init);
		if (listed?.repo === repo) {
			repoReads += 1;
			const closed = repoReads > 1;
			return (
				issuesResponse(input, init, [
					closed
						? ticket(1, "2026-04-02T00:00:00Z", "closed")
						: ticket(1, "2026-04-01T00:00:00Z"),
				]) ?? page([])
			);
		}
		if (listed?.repo === otherRepo) {
			otherReads += 1;
			if (otherReads > 1) {
				await otherHeld;
			}
			return (
				issuesResponse(
					input,
					init,
					[ticket(2, "2026-04-01T00:00:00Z")],
					otherRepo,
				) ?? page([])
			);
		}
		return recordedOrEmpty(url) ?? unrecorded(input);
	};
	await withServer(
		fetchImpl,
		3600,
		async (base) => {
			const first = await settledOverview(base, readOverview);
			const shownBefore = first.projects.find((item) => item.name === repo);
			expect(shownBefore?.backlog).toBe(1);
			expect(shownBefore?.done).toBe(0);
			const refresh = await fetch(new URL("/api/refresh", base), {
				method: "POST",
			});
			expect(refresh.status).toBe(204);
			while (otherReads < 2) {
				await Bun.sleep(20);
			}
			let shown = shownBefore;
			const deadline = Date.now() + 5_000;
			while (shown?.done !== 1 && Date.now() < deadline) {
				await Bun.sleep(20);
				const running = await readOverview(base);
				expect(running.polling).toBe(true);
				shown = running.projects.find((item) => item.name === repo);
			}
			expect(shown?.done).toBe(1);
			expect(shown?.backlog).toBe(0);
			releaseOther();
			const after = await settledOverview(base, readOverview);
			expect(after.projects.find((item) => item.name === repo)?.done).toBe(1);
			expect(
				after.projects.find((item) => item.name === otherRepo)?.backlog,
			).toBe(1);
		},
		[
			{ tracker: "github", repo: otherRepo },
			{ tracker: "github", repo },
		],
	);
}, 20_000);
