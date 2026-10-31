import { askAnswer, askId, progressAnswers, progressHeading } from "./ask.ts";
import type {
	Comment,
	LiveRun,
	PullRequest,
	Ticket,
	WorkcellRun,
} from "./domain.ts";
import { numberedKey, sameTicketKey } from "./ticket-key.ts";

const stageLine = /^stage\s+(\d+)\b/i;

const progressStallLimitMs = 2 * 60 * 60 * 1000;

const mergeAskLine = /^Merge PR #(\d+)\b/i;

const finalReportLine = /^(?:ask-\d+:\s+\S+\s+)?final report\b/i;

const reportMarker = "<!-- workcell:report -->";

function pullNumbers(text: string): number[] {
	const numbers: number[] = [];
	for (const match of text.matchAll(/\/pull\/(\d+)\b/gi)) {
		const number = Number(match[1]);
		if (!numbers.includes(number)) {
			numbers.push(number);
		}
	}
	const asked = text.match(mergeAskLine)?.[1];
	if (asked !== undefined) {
		const number = Number(asked);
		if (!numbers.includes(number)) {
			numbers.push(number);
		}
	}
	return numbers;
}

function isReportComment(body: string): boolean {
	if (body.includes(reportMarker)) {
		return true;
	}
	const first = body.split("\n")[0]?.trim() ?? "";
	return askId(body) !== null && finalReportLine.test(first);
}

function commentsAfter(comments: Comment[], progress: Comment): Comment[] {
	const progressAt = comments.indexOf(progress);
	return comments.slice(progressAt + 1);
}

function progressComment(comments: Comment[]):
	| {
			progress: Comment;
			lines: string[];
			later: Comment[];
			reportAt: number;
			report: Comment | undefined;
	  }
	| undefined {
	const progress = comments.find(
		(comment) => comment.body.split("\n")[0]?.trim() === progressHeading,
	);
	if (progress === undefined) {
		return undefined;
	}
	const lines = progress.body
		.split("\n")
		.map((line) => line.trim().replace(/^-\s*/, ""))
		.filter((line) => line !== "" && line !== progressHeading);
	const later = commentsAfter(comments, progress);
	return {
		progress,
		lines,
		later,
		reportAt: lines.findLastIndex((line) => finalReportLine.test(line)),
		report: later.findLast(
			(comment) => comment !== progress && isReportComment(comment.body),
		),
	};
}

function resumedAfterReport(
	found: NonNullable<ReturnType<typeof progressComment>>,
	countsStage: (line: string) => boolean = (line) => stageLine.test(line),
): boolean {
	const { lines, reportAt, report } = found;
	if (reportAt < 0 && report === undefined) {
		return false;
	}
	const reportAsk = report === undefined ? null : askId(report.body);
	return lines
		.slice(reportAt < 0 ? lines.length : reportAt + 1)
		.some(
			(line) =>
				countsStage(line) ||
				(reportAsk !== null && progressAnswers(line, reportAsk)),
		);
}

export function progressRun(
	comments: Comment[],
	now: Date,
): LiveRun | undefined {
	const found = progressComment(comments);
	if (found === undefined) {
		return undefined;
	}
	const { lines, reportAt, progress } = found;
	const resumed = resumedAfterReport(found);
	const counted = resumed || reportAt < 0 ? lines : lines.slice(0, reportAt);
	let stage: string | undefined;
	for (const line of counted) {
		const stageMatch = line.match(stageLine);
		if (stageMatch?.[1] === undefined) {
			continue;
		}
		stage = `stage ${stageMatch[1]}`;
	}
	if (stage === undefined) {
		return undefined;
	}
	const open = resumed || reportAt < 0;
	const stalled = open && progressOlderThanStallLimit(progress, now);
	return {
		status: stalled ? "failed" : "running",
		stage,
	};
}

function progressOlderThanStallLimit(progress: Comment, now: Date): boolean {
	const updatedAt = progress.updatedAt;
	if (updatedAt === undefined) {
		return false;
	}
	const updated = Date.parse(updatedAt);
	if (Number.isNaN(updated)) {
		return false;
	}
	return now.getTime() - updated > progressStallLimitMs;
}

export function workcellRun(
	comments: Comment[],
	pull: PullRequest,
): { state: "inReview" | "awaitingMerge"; tags: string[] } | null {
	const found = progressComment(comments);
	if (found === undefined) {
		return null;
	}
	const { lines, later, reportAt, report } = found;
	if (reportAt >= 0 || report !== undefined) {
		if (
			resumedAfterReport(
				found,
				(line) => stageLine.test(line) && !namesAnotherPull(line, pull),
			)
		) {
			return { state: "inReview", tags: [] };
		}
		if (report !== undefined && commentNamesPull(report.body, pull.number)) {
			const open =
				askId(report.body) === null || askAnswer(comments, report) === null;
			return { state: open ? "awaitingMerge" : "inReview", tags: [] };
		}
		if (reportAt >= 0 && lineDecidesPull(lines[reportAt] ?? "", pull, lines)) {
			return { state: "awaitingMerge", tags: [] };
		}
	}
	const mergeAsk = openMergeAsk(later, pull.number);
	if (mergeAsk !== undefined && askAnswer(comments, mergeAsk) === null) {
		return { state: "awaitingMerge", tags: [] };
	}
	let stage: number | null = null;
	for (const line of lines) {
		const stageMatch = line.match(stageLine);
		if (stageMatch?.[1] !== undefined && lineDecidesPull(line, pull, lines)) {
			stage = Number(stageMatch[1]);
		}
	}
	if (stage !== null && stage <= 5) {
		return { state: "inReview", tags: [] };
	}
	return null;
}

function lineDecidesPull(
	line: string,
	pull: PullRequest,
	lines: string[],
): boolean {
	const numbers = pullNumbers(line);
	if (numbers.length > 0) {
		return numbers.includes(pull.number);
	}
	return !lines.some((item) => pullNumbers(item).length > 0);
}

function namesAnotherPull(line: string, pull: PullRequest): boolean {
	const numbers = pullNumbers(line);
	return numbers.length > 0 && !numbers.includes(pull.number);
}

function commentNamesPull(body: string, number: number): boolean {
	const numbers = pullNumbers(body);
	return numbers.length === 0 || numbers.includes(number);
}

function openMergeAsk(later: Comment[], number: number): Comment | undefined {
	return later.findLast((comment) => {
		if (
			askId(comment.body) === null ||
			!commentNamesPull(comment.body, number)
		) {
			return false;
		}
		const first = comment.body.split("\n")[0]?.trim() ?? "";
		return (
			first.match(mergeAskLine)?.[1] === String(number) ||
			comment.body.includes(reportMarker) ||
			finalReportLine.test(first)
		);
	});
}

const pullUrl = /\bhttps?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+\b/gi;

/** The host and path of a PR URL, folded, or null when the text is no URL. */
function pullTarget(url: string): string | null {
	const parsed = URL.parse(url);
	return parsed === null
		? null
		: `${parsed.host}${parsed.pathname}`.toLowerCase();
}

/**
 * True when a progress line names the PR. A PR URL names the PR on its host
 * and repo. A line with no PR URL names the PR by its number.
 */
function lineNamesPull(line: string, pull: PullRequest): boolean {
	const urls = line.match(pullUrl);
	if (urls === null) {
		return pullNumbers(line).includes(pull.number);
	}
	const target = pullTarget(pull.url);
	return (
		urls.some((url) => target !== null && pullTarget(url) === target) ||
		line.match(mergeAskLine)?.[1] === String(pull.number)
	);
}

/** True when the workcell progress comment names the PR. */
export function progressNamesPull(
	comments: Comment[],
	pull: PullRequest,
): boolean {
	return (
		progressComment(comments)?.lines.some((line) =>
			lineNamesPull(line, pull),
		) === true
	);
}

export function runFor<Run extends Pick<WorkcellRun, "key" | "repo">>(
	ticket: Ticket,
	runs: Run[],
): Run | undefined {
	return runsFor(ticket, runs)[0];
}

/** The runs of a ticket, in the order of `runs`. */
export function runsFor<Run extends Pick<WorkcellRun, "key" | "repo">>(
	ticket: Ticket,
	runs: Run[],
): Run[] {
	const key = ticket.key;
	if (key === null) {
		return [];
	}
	return runs.filter((run) => isRunOf(run, key));
}

/** True when `run` is a run of the ticket with `key`. A GitHub run can name its ticket by number and repo. */
export function isRunOf(
	run: Pick<WorkcellRun, "key" | "repo">,
	key: string,
): boolean {
	return (
		sameTicketKey(run.key, key) ||
		(run.repo !== undefined &&
			sameTicketKey(numberedKey(run.repo, run.key), key))
	);
}
