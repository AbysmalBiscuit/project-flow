import { Database, type SQLQueryBindings } from "bun:sqlite";

import { z } from "zod";

import type { RunAsks } from "./factory-run-rows.ts";
import type { RunListRow } from "./run-list.ts";
import type { RecordedTurn } from "./run-usage.ts";

/** The most rows that an insight query answers. */
export const insightRowLimit = 5_000;

/** A queryable view over the run history, with the names of its columns. */
export type InsightTable = { name: string; columns: string[] };

export type InsightTables = { tables: InsightTable[] };

export type InsightValue = string | number | null;

export type InsightAnswer = {
	columns: string[];
	rows: InsightValue[][];
	rowCount: number;
	/** True when the result had more rows than `insightRowLimit`. */
	truncated: boolean;
	ms: number;
};

export type InsightResult = InsightAnswer | { error: string };

/** The columns of the `runs` view, in order, from the run list row. */
const runColumns = {
	id: (row: RunListRow) => row.id,
	ticket: (row) => row.key,
	project: (row) => row.project ?? null,
	package: (row) => row.workflowPackage ?? null,
	status: (row) => row.statusKind,
	reason: (row) => row.failureReason ?? null,
	result: (row) => row.result ?? null,
	factory: (row) => row.factory,
	box: (row) => row.box,
	submitted_at: (row) => row.submittedAt,
	started_at: (row) => row.startedAt,
	ended_at: (row) => row.endedAt,
	archived_at: (row) => row.archivedAt ?? null,
	input_tokens: (row) => row.usageTotals?.inputTokens ?? null,
	output_tokens: (row) => row.usageTotals?.outputTokens ?? null,
	cost_usd: (row) => row.usageTotals?.costUsd ?? null,
	duration_s: (row) => row.usageTotals?.durationS ?? null,
} satisfies Record<string, (row: RunListRow) => InsightValue>;

const columnNames = Object.keys(runColumns);

/** The events of the factory feed and of a run's event log that give stage rows. */
export const stageEvents: ReadonlySet<string> = new Set([
	"stage.completed",
	"stage.failed",
	"stage.retrying",
]);

/** One event of a run that may give a stage row. */
export type StageEvent = {
	event: string;
	stage: string;
	at: string;
	data: unknown;
};

/** The parts of a stage event's `data` that a stage row keeps. */
const stageData = z
	.object({
		duration: z.number().optional().catch(undefined),
		error: z.string().nullish().catch(undefined),
		will_retry: z.boolean().optional().catch(undefined),
		attempt: z.number().optional().catch(undefined),
	})
	.catch({});

/** The factory reads that fill the run history of an ended run once. */
export type HistoryRead = "events" | "turns";

/** The views that an insight query can read. Later run history tables add theirs. */
const queryableViews = ["runs", "stages", "turns", "asks"];

/** Whitespace, semicolons and comments: what may follow the one statement of a query. */
const statementTail = /^(?:\s|;|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*$/;

function insightValue(value: unknown): InsightValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number"
	) {
		return value;
	}
	if (value instanceof Uint8Array) {
		return `[${value.byteLength} bytes]`;
	}
	return String(value);
}

export type RunHistory = ReturnType<typeof runHistory>;

/** The run history in the store, and insight queries over it on a read-only connection. */
export function runHistory(db: Database, path: string) {
	db.run(
		`create table if not exists run_history (id text primary key, ${columnNames.slice(1).join(", ")})`,
	);
	db.run(
		`create view if not exists runs as select ${columnNames.join(", ")} from run_history`,
	);
	db.run(`
		create table if not exists run_stages (
			run_id text not null, stage text not null, event text not null, at text not null,
			duration_s real, will_retry integer, attempt integer, error text,
			primary key (run_id, at, stage, event)
		)
	`);
	db.run(
		"create view if not exists stages as select run_id, stage, event, at, duration_s, will_retry, attempt, error from run_stages",
	);
	db.run(`
		create table if not exists run_turns (
			run_id text not null, turn integer not null, stage text not null,
			input_tokens integer, output_tokens integer, cost_usd real, duration_s real, tools text,
			primary key (run_id, turn)
		)
	`);
	db.run(
		"create view if not exists turns as select run_id, turn, stage, input_tokens, output_tokens, cost_usd, duration_s, tools from run_turns",
	);
	db.run(`
		create table if not exists run_asks (
			run_id text not null, id text not null, stage text, text text not null,
			answer text, sender text, answered_at text,
			primary key (run_id, id)
		)
	`);
	db.run(
		"create view if not exists asks as select run_id, id, stage, text, answer, sender, answered_at from run_asks",
	);
	db.run(
		"create table if not exists run_history_reads (run_id text not null, read text not null, ended_at text, primary key (run_id, read))",
	);
	const insertStage = db.query<unknown, SQLQueryBindings[]>(
		"insert or ignore into run_stages (run_id, stage, event, at, duration_s, will_retry, attempt, error) values (?, ?, ?, ?, ?, ?, ?, ?)",
	);
	const insertTurn = db.query<unknown, SQLQueryBindings[]>(
		"insert into run_turns (run_id, turn, stage, input_tokens, output_tokens, cost_usd, duration_s, tools) values (?, ?, ?, ?, ?, ?, ?, ?)",
	);
	const upsertAsk = db.query<unknown, SQLQueryBindings[]>(
		`insert into run_asks (run_id, id, stage, text, answer, sender, answered_at) values (?, ?, ?, ?, ?, ?, ?)
		on conflict(run_id, id) do update set stage = excluded.stage, text = excluded.text,
		answer = coalesce(excluded.answer, answer), sender = coalesce(excluded.sender, sender),
		answered_at = coalesce(excluded.answered_at, answered_at)`,
	);
	const markRead = db.query<unknown, SQLQueryBindings[]>(
		"insert into run_history_reads (run_id, read, ended_at) values (?, ?, ?) on conflict(run_id, read) do update set ended_at = excluded.ended_at",
	);
	const readsOf = db.query<{ read: HistoryRead }, [string, string | null]>(
		"select read from run_history_reads where run_id = ? and ended_at is ?",
	);
	const hasStages = db.query<unknown, [string]>(
		"select 1 from run_stages where run_id = ? limit 1",
	);
	const addStage = (runId: string, event: StageEvent) => {
		if (!stageEvents.has(event.event)) {
			return;
		}
		const data = stageData.parse(event.data);
		insertStage.run(
			runId,
			event.stage,
			event.event,
			event.at,
			data.duration ?? null,
			data.will_retry === undefined ? null : Number(data.will_retry),
			data.attempt ?? null,
			data.error ?? null,
		);
	};
	const upsert = db.query<unknown, SQLQueryBindings[]>(
		`insert into run_history (${columnNames.join(", ")}) values (${columnNames.map(() => "?").join(", ")}) on conflict(id) do update set ${columnNames
			.filter((name) => name !== "id")
			.map((name) => `${name} = excluded.${name}`)
			.join(", ")}`,
	);
	// SQLite cannot open an in-memory store read-only, so the first query opens the reader.
	let reader: Database | null = null;
	let recorded = "";
	return {
		/** Write each run of the run list into the history. An unchanged list writes nothing. */
		record(rows: RunListRow[]): void {
			const values = rows.map((row) =>
				Object.values(runColumns).map((column) => column(row)),
			);
			const text = JSON.stringify(values);
			if (text === recorded) {
				return;
			}
			db.transaction(() => {
				for (const row of values) {
					upsert.run(...row);
				}
			})();
			recorded = text;
		},
		/** Drop the rows of a run that Lev deleted, so each view drops them too. */
		forget(runId: string): void {
			db.transaction(() => {
				db.query("delete from run_history where id = ?").run(runId);
				for (const table of [
					"run_stages",
					"run_turns",
					"run_asks",
					"run_history_reads",
				]) {
					db.query(`delete from ${table} where run_id = ?`).run(runId);
				}
			})();
		},
		/** Keep the stage row of one event of the factory feed. Other events give no row. */
		recordStage: addStage,
		/**
		 * Keep the stage rows of an ended run's event log, and remember the read
		 * with the run's end time. Null events mean the factory does not serve the log.
		 */
		recordEventLog(
			runId: string,
			endedAt: string | null,
			events: StageEvent[] | null,
		): void {
			db.transaction(() => {
				for (const event of events ?? []) {
					addStage(runId, event);
				}
				markRead.run(runId, "events", endedAt);
			})();
		},
		/** Keep the turn rows of an ended run, and remember the read with the run's end time. */
		recordTurns(
			runId: string,
			endedAt: string | null,
			turns: RecordedTurn[],
		): void {
			db.transaction(() => {
				db.query("delete from run_turns where run_id = ?").run(runId);
				turns.forEach((turn, index) => {
					insertTurn.run(
						runId,
						index,
						turn.nodePath,
						turn.usage.inputTokens,
						turn.usage.outputTokens,
						turn.usage.costUsd,
						turn.usage.durationS,
						JSON.stringify(turn.usage.tools),
					);
				});
				markRead.run(runId, "turns", endedAt);
			})();
		},
		/** Keep the open and answered asks of a run. An answer stays after its ask closes. */
		recordAsks(runId: string, asks: RunAsks): void {
			db.transaction(() => {
				for (const ask of asks.questions) {
					upsertAsk.run(
						runId,
						ask.id,
						ask.node_path ?? null,
						ask.text,
						null,
						null,
						null,
					);
				}
				for (const ask of asks.answered) {
					upsertAsk.run(
						runId,
						ask.id,
						ask.node_path ?? null,
						ask.text,
						ask.answer,
						ask.sender ?? null,
						ask.answered_at,
					);
				}
			})();
		},
		/**
		 * The reads that an ended run still needs: its event log while it has no
		 * stage rows, and its turns. Each read runs once for each end of the run,
		 * so a resumed run that ends again gets its turns read again.
		 */
		unread(runId: string, endedAt: string | null): HistoryRead[] {
			const done = new Set(readsOf.all(runId, endedAt).map((row) => row.read));
			const reads: HistoryRead[] = [];
			if (!done.has("events") && hasStages.get(runId) === null) {
				reads.push("events");
			}
			if (!done.has("turns")) {
				reads.push("turns");
			}
			return reads;
		},
		tables(): InsightTables {
			return {
				tables: queryableViews.map((name) => ({
					name,
					columns: (
						db.query(`pragma table_info(${name})`).all() as {
							name: string;
						}[]
					).map((column) => column.name),
				})),
			};
		},
		/** Run one SQL statement on the read-only connection. */
		query(sql: string): InsightResult {
			const started = performance.now();
			try {
				reader ??= new Database(path, { readonly: true });
				const statement = reader.prepare(sql);
				if (!statementTail.test(sql.slice(statement.toString().length))) {
					statement.finalize();
					return { error: "run one statement at a time" };
				}
				const columns = statement.columnNames;
				if (new Set(columns).size < columns.length) {
					statement.finalize();
					return {
						error: `name each column once, such as with "as": ${columns.join(", ")}`,
					};
				}
				const rows: InsightValue[][] = [];
				let truncated = false;
				for (const row of statement.iterate() as Iterable<
					Record<string, unknown>
				>) {
					if (rows.length === insightRowLimit) {
						truncated = true;
						break;
					}
					rows.push(columns.map((name) => insightValue(row[name])));
				}
				statement.finalize();
				return {
					columns,
					rows,
					rowCount: rows.length,
					truncated,
					ms: Math.round(performance.now() - started),
				};
			} catch (error) {
				return {
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
		close: () => reader?.close(),
	};
}
