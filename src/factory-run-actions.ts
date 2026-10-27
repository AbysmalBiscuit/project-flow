import { z } from "zod";

import type { RunMessage } from "./domain.ts";
import {
	body,
	factoryRequestLimitMs,
	reader,
	Unreachable,
} from "./factory-http.ts";
import type { ReadRun, StatusRows } from "./factory-run-rows.ts";
import type { Fetch } from "./fetch.ts";

export type AnswerResult = "answered" | "missing" | "failed";

export type SteerResult = "steered" | "missing" | "ended" | "failed";

export type CancelResult = "cancelled" | "missing" | "ended" | "failed";

/** The id of the run that a resume queued again, or of the new run that a restart started. */
export type StartResult = { id: string } | "missing" | "ended" | "failed";

export type Steer = { stage: string; text: string; interrupt: boolean };

// A factory answers a cancel once the run process has stopped. The hub waits 30 seconds for
// the box, and the box waits up to 60 seconds for the process to stop.
const cancelLimitMs = 100_000;

const startedRun = z.object({ id: z.string() });

/** Project Flow writes to a factory as Lev: the factory records this sender on each answer and steer. */
const levSender = "lev";

/** The answer, steer, cancel, resume and restart writes that Lev sends to the factory that reports a run. */
export function runActions(deps: {
	fetchImpl: Fetch;
	signal: AbortSignal;
	now: () => Date;
	statusRowOf: (runId: string) => StatusRows<ReadRun>;
	addMessage: (runId: string, message: RunMessage, once?: string) => void;
}) {
	const { fetchImpl, signal, now, statusRowOf, addMessage } = deps;
	const answer = async (
		run: string,
		question: string,
		text: string,
	): Promise<AnswerResult> => {
		const { hubRow, row } = statusRowOf(run);
		// Only the hub posts an answer to the ticket thread, so a hub-covered run answers there.
		const target = hubRow ?? row;
		if (
			target === undefined ||
			row?.run.questions?.some((item) => item.id === question) !== true
		) {
			return "missing";
		}
		const read = reader(fetchImpl, target.url, signal);
		try {
			const response = await read(
				`/runs/${encodeURIComponent(run)}/questions/${encodeURIComponent(question)}/answer`,
				{ json: { text, sender: levSender } },
			);
			if (response.ok) {
				addMessage(
					run,
					{
						kind: "answer",
						sender: levSender,
						text,
						at: now().toISOString(),
					},
					`answer ${question}`,
				);
				return "answered";
			}
			return response.status === 404 ? "missing" : "failed";
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return "failed";
		}
	};
	/**
	 * Post a write about a run to the hub that reports it, or else to its box. The hub forwards
	 * the write to the box that does the run. A 409 means that the run is not in a status that
	 * takes the write.
	 */
	const runWrite = async <Done>(
		run: string,
		route: string,
		done: (response: Response) => Done | Promise<Done>,
		json: unknown = {},
		limitMs = factoryRequestLimitMs,
	): Promise<Done | "missing" | "ended" | "failed"> => {
		const { hubRow, row } = statusRowOf(run);
		const target = hubRow ?? row;
		if (target === undefined) {
			return "missing";
		}
		const read = reader(fetchImpl, target.url, signal, limitMs);
		try {
			const response = await read(`/runs/${encodeURIComponent(run)}/${route}`, {
				json,
			});
			if (response.ok) {
				return await done(response);
			}
			if (response.status === 409) {
				return "ended";
			}
			return response.status === 404 ? "missing" : "failed";
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return "failed";
		}
	};
	const steer = (run: string, steer: Steer): Promise<SteerResult> =>
		runWrite(run, "steer", () => "steered" as const, {
			...steer,
			sender: levSender,
		});
	const cancel = (run: string): Promise<CancelResult> =>
		runWrite(run, "cancel", () => "cancelled" as const, {}, cancelLimitMs);
	const startedId = async (response: Response) => ({
		id: (await body(response, startedRun)).id,
	});
	const resume = (run: string): Promise<StartResult> =>
		runWrite(run, "resume", startedId);
	// A restart of a blocked run cancels it first, so it waits as long as a cancel.
	const restart = (run: string): Promise<StartResult> =>
		runWrite(run, "restart", startedId, {}, cancelLimitMs);
	return { answer, steer, cancel, resume, restart };
}
