import { z } from "zod";

import type { Configuration } from "./configuration.ts";
import type { RemoveAction, StartResult } from "./factory-run-actions.ts";
import type { PollOptions } from "./poll.ts";
import type { Clock, FactoryReader } from "./ports.ts";
import { factoryRunList } from "./project-views.ts";
import { routeTable } from "./route-table.ts";
import type { staleReads } from "./stale-reads.ts";

const answerBody = z.object({ text: z.string().trim().min(1) });

const steerBody = z.object({
	stage: z.string().trim().min(1),
	text: z.string().trim().min(1),
	interrupt: z.boolean().default(false),
});

export type FactoryRunRouteOptions = {
	factories: FactoryReader;
	pollOptions: PollOptions;
	configuration: () => Configuration;
	clock: Clock;
	staleRead: ReturnType<typeof staleReads>;
	readKey: (request: Request) => string;
	readFactories: (read: () => Promise<void>) => Promise<void>;
	publishOverview: () => void;
};

/** The routes of `/api/factory-runs`: run reads, and the actions that a run takes. */
export function factoryRunRoutes({
	factories,
	pollOptions,
	configuration,
	clock,
	staleRead,
	readKey,
	readFactories,
	publishOverview,
}: FactoryRunRouteOptions) {
	/** The API answer to a resume or a restart: the id of the run that the factory started. */
	const startAgain = async (started: Promise<StartResult>) => {
		const result = await started;
		if (result === "missing") {
			return Response.json(
				{ error: "no factory reports the run" },
				{ status: 404 },
			);
		}
		if (result === "ended") {
			return Response.json(
				{ error: "the run is not blocked or failed" },
				{ status: 409 },
			);
		}
		if (result === "failed") {
			return Response.json(
				{ error: "the factory did not start the run" },
				{ status: 502 },
			);
		}
		await readFactories(() => factories.readRuns(clock.now().getTime()));
		return Response.json({ id: result.id });
	};
	/** The API answer to a delete or an archive of an ended run. */
	const remove = async (run: string, action: RemoveAction) => {
		const result = await factories.remove(run, action);
		if (result === "missing") {
			return Response.json(
				{ error: "no factory reports the run" },
				{ status: 404 },
			);
		}
		if (result === "failed") {
			return Response.json(
				{ error: `the factory did not take the ${action}` },
				{ status: 502 },
			);
		}
		if (result !== "removed") {
			return Response.json({ error: result.refused }, { status: 409 });
		}
		await readFactories(() => factories.readRuns(clock.now().getTime()));
		return Response.json(
			action === "delete" ? { deleted: true } : { archived: true },
		);
	};
	const readWorkflow = async (runId: string) => {
		if (await factories.readWorkflow(runId)) {
			publishOverview();
		}
	};
	return routeTable({
		"/api/factory-runs": {
			GET: () => Response.json(factoryRunList(pollOptions, configuration())),
		},
		"/api/factory-runs/:id": {
			GET: (request) => {
				const found = factories.run(request.params.id);
				if (found === null) {
					return Response.json({ missing: true }, { status: 404 });
				}
				if (found.workflow === undefined) {
					void readWorkflow(found.id).catch(() => {});
				}
				return Response.json(found);
			},
		},
		"/api/factory-runs/:id/checkpoint": {
			GET: (request) =>
				staleRead(readKey(request), async () => {
					const found = await factories.checkpoint(request.params.id);
					if (found === "missing") {
						return Response.json({ missing: true }, { status: 404 });
					}
					if (found === "not served") {
						return Response.json({ notServed: true }, { status: 404 });
					}
					return Response.json(found);
				}),
		},
		"/api/factory-runs/:id/agents": {
			GET: (request) =>
				staleRead(readKey(request), async () => {
					const found = await factories.agents(request.params.id);
					return found === null
						? Response.json({ missing: true }, { status: 404 })
						: Response.json({ agents: found });
				}),
		},
		"/api/factory-runs/:id/events": {
			GET: (request, server) => {
				server.timeout(request, 0);
				return (
					factories.events(
						request.params.id,
						request.headers.get("last-event-id"),
						request.signal,
					) ?? Response.json({ missing: true }, { status: 404 })
				);
			},
		},
		"/api/factory-runs/:id/artifacts": {
			GET: (request) =>
				staleRead(readKey(request), async () => {
					const found = await factories.artifacts(request.params.id);
					if (found === "missing") {
						return Response.json({ missing: true }, { status: 404 });
					}
					if (found === "not served") {
						return Response.json({ notServed: true }, { status: 404 });
					}
					return Response.json({ artifacts: found });
				}),
		},
		"/api/factory-runs/:id/sandbox": {
			GET: (request) =>
				staleRead(readKey(request), async () => {
					const found = await factories.sandbox(request.params.id);
					if (found === "missing") {
						return Response.json({ missing: true }, { status: 404 });
					}
					if (found === "not served") {
						return Response.json({ notServed: true }, { status: 404 });
					}
					return Response.json(found);
				}),
		},
		"/api/factory-runs/:id/files": {
			GET: (request) =>
				staleRead(readKey(request), async () => {
					const found = await factories.files(request.params.id);
					if (found === "missing") {
						return Response.json({ missing: true }, { status: 404 });
					}
					if (found === "gone") {
						return Response.json({ gone: true }, { status: 404 });
					}
					if (found === "not served") {
						return Response.json({ notServed: true }, { status: 404 });
					}
					return Response.json({ files: found });
				}),
		},
		"/api/factory-runs/:id/source": {
			GET: (request) =>
				staleRead(readKey(request), async () => {
					const found = await factories.source(request.params.id);
					if (found === "missing") {
						return Response.json({ missing: true }, { status: 404 });
					}
					if (found === "not served") {
						return Response.json({ notServed: true }, { status: 404 });
					}
					return Response.json(found);
				}),
		},
		"/api/factory-runs/:id/settings": {
			GET: (request) =>
				staleRead(readKey(request), async () => {
					const found = await factories.settings(request.params.id);
					if (found === "missing") {
						return Response.json({ missing: true }, { status: 404 });
					}
					if (found === "not served") {
						return Response.json({ notServed: true }, { status: 404 });
					}
					return Response.json(found);
				}),
		},
		"/api/factory-runs/:id/artifact": {
			GET: (request) =>
				staleRead(readKey(request), async () => {
					const query = new URL(request.url).searchParams;
					const found = await factories.artifact(
						request.params.id,
						query.get("folder") ?? "",
						query.get("name") ?? "",
					);
					return found === null
						? Response.json({ missing: true }, { status: 404 })
						: Response.json(found);
				}),
		},
		"/api/factory-runs/:run/questions/:question/answer": {
			POST: async (request) => {
				const parsed = answerBody.safeParse(
					await request.json().catch(() => null),
				);
				if (!parsed.success) {
					return Response.json({ error: "answer is empty" }, { status: 400 });
				}
				const result = await factories.answer(
					request.params.run,
					request.params.question,
					parsed.data.text,
				);
				if (result === "missing") {
					return Response.json(
						{ error: "the run waits on no such question" },
						{ status: 404 },
					);
				}
				if (result === "failed") {
					return Response.json(
						{ error: "the factory did not take the answer" },
						{ status: 502 },
					);
				}
				await readFactories(() => factories.readRuns(clock.now().getTime()));
				return Response.json({ answered: true });
			},
		},
		"/api/factory-runs/:run/steer": {
			POST: async (request) => {
				const parsed = steerBody.safeParse(
					await request.json().catch(() => null),
				);
				if (!parsed.success) {
					return Response.json(
						{ error: "a steer needs a stage and a text" },
						{ status: 400 },
					);
				}
				const result = await factories.steer(request.params.run, parsed.data);
				if (result === "missing") {
					return Response.json(
						{ error: "no factory reports the run" },
						{ status: 404 },
					);
				}
				if (result === "ended") {
					return Response.json(
						{ error: "the run has ended, so it takes no steer" },
						{ status: 409 },
					);
				}
				if (result === "failed") {
					return Response.json(
						{ error: "the factory did not take the steer" },
						{ status: 502 },
					);
				}
				return Response.json({ steered: true });
			},
		},
		"/api/factory-runs/:run/cancel": {
			POST: async (request) => {
				const result = await factories.cancel(request.params.run);
				if (result === "missing") {
					return Response.json(
						{ error: "no factory reports the run" },
						{ status: 404 },
					);
				}
				if (result === "ended") {
					return Response.json(
						{ error: "the run has already ended" },
						{ status: 409 },
					);
				}
				if (result === "failed") {
					return Response.json(
						{ error: "the factory did not take the cancel" },
						{ status: 502 },
					);
				}
				await readFactories(() => factories.readRuns(clock.now().getTime()));
				return Response.json({ cancelled: true });
			},
		},
		"/api/factory-runs/:run/resume": {
			POST: (request) => startAgain(factories.resume(request.params.run)),
		},
		"/api/factory-runs/:run/restart": {
			POST: (request) => startAgain(factories.restart(request.params.run)),
		},
		"/api/factory-runs/:run/delete": {
			POST: (request) => remove(request.params.run, "delete"),
		},
		"/api/factory-runs/:run/archive": {
			POST: (request) => remove(request.params.run, "archive"),
		},
	});
}
