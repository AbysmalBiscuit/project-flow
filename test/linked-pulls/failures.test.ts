import { describe, expect, test } from "bun:test";

import { repo } from "../support/github.ts";
import {
	type Answer,
	type Linked,
	list,
	pullNode,
	pullsByNumberRequests,
	type Read,
	readLinked,
} from "./_support.ts";

describe("linked PR read failures", () => {
	test("a malformed later page drops only the PR that owns it", async () => {
		const read = await readLinked([83, 84], {
			answers: new Map<number, Answer>([
				[83, pullNode(83, { reviews: list([], "reviews-2") })],
				[84, pullNode(84)],
			]),
			laterPages: new Map([["PR_83@reviews-2", { reviews: "malformed" }]]),
		});
		expect(read.error).toBeNull();
		expect(read.tickets.map(({ key, pull }) => ({ key, pull }))).toEqual(
			expect.arrayContaining([
				{ key: "WID-83", pull: undefined },
				{ key: "WID-84", pull: `${repo}#84` },
			]),
		);
	});

	test("a failed linked PR read fails the poll and keeps the PRs of the last good poll", async () => {
		const linked: Linked = {
			answers: new Map<number, Answer>([
				[83, pullNode(83)],
				[84, pullNode(84)],
			]),
			again: () => {
				linked.status = 502;
			},
		};
		const read = await readLinked([83, 84], linked);
		const shown = [
			{ key: "WID-83", pull: `${repo}#83` },
			{ key: "WID-84", pull: `${repo}#84` },
		];
		const pulls = (tickets: Read["tickets"]) =>
			tickets.map(({ key, pull }) => ({ key, pull }));
		expect(read.before?.error).toBeNull();
		expect(pulls(read.before?.tickets ?? [])).toEqual(
			expect.arrayContaining(shown),
		);
		expect(pullsByNumberRequests(read.sent).length).toBeGreaterThan(
			pullsByNumberRequests(read.before?.sent ?? []).length,
		);
		expect(read.error).not.toBeNull();
		expect(pulls(read.tickets)).toEqual(expect.arrayContaining(shown));
	});

	test("a linked PR that GitHub cannot find or read does not fail the other PRs of its chunk", async () => {
		const read = await readLinked([83, 84, 85], {
			answers: new Map<number, Answer>([
				[83, pullNode(83)],
				[84, "missing"],
				[85, "unreadable"],
			]),
		});
		expect(pullsByNumberRequests(read.sent)).toHaveLength(1);
		expect(read.error).toBeNull();
		expect(read.tickets.map(({ key, pull }) => ({ key, pull }))).toEqual(
			expect.arrayContaining([
				{ key: "WID-83", pull: `${repo}#83` },
				{ key: "WID-84", pull: undefined },
				{ key: "WID-85", pull: undefined },
			]),
		);
	});
});
