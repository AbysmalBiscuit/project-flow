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

/** The factory answered a write about a run with 409, with the reason that its body names, if any. */
export type Refused = { refused: string | undefined };

export type AnswerResult = "answered" | "missing" | Refused | "failed";

export type SteerResult = "steered" | "missing" | Refused | "failed";

export type CancelResult = "cancelled" | "missing" | Refused | "failed";

/** The id of the run that a resume queued again, or of the new run that a restart started. */
export type StartResult = { id: string } | "missing" | Refused | "failed";

export type RemoveAction = "delete" | "archive";

export type RemoveResult =
	"removed" | "missing" | { refused: string } | "failed";

export type Steer = { stage: string; text: string; interrupt: boolean };

// A factory answers a cancel once the run process has stopped. The hub waits 30 seconds for
// the box, and the box waits up to 60 seconds for the process to stop.
const cancelLimitMs = 100_000;

const startedRun = z.object({ id: z.string() });

const refusal = z.object({ error: z.string().trim().min(1) });

/** The reason that the body of a 409 names, if any. */
async function refusedBy(response: Response): Promise<Refused> {
	const named = refusal.safeParse(await response.json().catch(() => null));
	return { refused: named.data?.error };
}

/** Project Flow writes to a factory as Lev: the factory records this sender on each answer and steer. */
const levSender = "lev";

/** The answer, steer, cancel, resume, restart, delete and archive writes that Lev sends to the factory that reports a run. */
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
		const { row } = statusRowOf(run);
		if (row?.run.questions?.some((item) => item.id === question) !== true) {
			return "missing";
		}
		const response = await post(
			run,
			`questions/${encodeURIComponent(question)}/answer`,
			{ text, sender: levSender },
			factoryRequestLimitMs,
		);
		if (typeof response === "string") {
			return response;
		}
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
		if (response.status === 409) {
			return await refusedBy(response);
		}
		return response.status === 404 ? "missing" : "failed";
	};
	/**
	 * Post a write about a run to the hub that reports it, or else to its box. The hub forwards
	 * the write to the box that does the run. Only the hub posts an answer to the ticket thread,
	 * so a hub-covered run takes each write there.
	 */
	const post = async (
		run: string,
		route: string,
		json: unknown,
		limitMs: number,
	): Promise<Response | "missing" | "failed"> => {
		const { hubRow, row } = statusRowOf(run);
		const target = hubRow ?? row;
		if (target === undefined) {
			return "missing";
		}
		const read = reader(fetchImpl, target.url, signal, limitMs);
		try {
			return await read(`/runs/${encodeURIComponent(run)}/${route}`, { json });
		} catch (error) {
			if (!(error instanceof Unreachable)) {
				throw error;
			}
			return "failed";
		}
	};
	/** A write that the factory refuses with 409, with a reason in its body, when the run is not in a status that takes it. */
	const runWrite = async <Done>(
		run: string,
		route: string,
		done: (response: Response) => Done | Promise<Done>,
		json: unknown = {},
		limitMs = factoryRequestLimitMs,
	): Promise<Done | "missing" | Refused | "failed"> => {
		const response = await post(run, route, json, limitMs);
		if (typeof response === "string") {
			return response;
		}
		if (response.status === 409) {
			return await refusedBy(response);
		}
		if (!response.ok) {
			return response.status === 404 ? "missing" : "failed";
		}
		try {
			return await done(response);
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
	/** A delete or an archive of an ended run. A 409 gives the reason of the factory, such as a PR that a hub source still needs. */
	const remove = async (
		run: string,
		action: RemoveAction,
	): Promise<RemoveResult> => {
		const response = await post(run, action, {}, factoryRequestLimitMs);
		if (typeof response === "string") {
			return response;
		}
		if (response.ok) {
			return "removed";
		}
		if (response.status === 409) {
			const { refused } = await refusedBy(response);
			return { refused: refused ?? "the factory keeps the run" };
		}
		return response.status === 404 ? "missing" : "failed";
	};
	return { answer, steer, cancel, resume, restart, remove };
}
