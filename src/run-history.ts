import { Database, type SQLQueryBindings } from "bun:sqlite";

import type { RunListRow } from "./run-list.ts";

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
	input_tokens: (row) => row.usageTotals?.inputTokens ?? null,
	output_tokens: (row) => row.usageTotals?.outputTokens ?? null,
	cost_usd: (row) => row.usageTotals?.costUsd ?? null,
	duration_s: (row) => row.usageTotals?.durationS ?? null,
} satisfies Record<string, (row: RunListRow) => InsightValue>;

const columnNames = Object.keys(runColumns);

/** The views that an insight query can read. Later run history tables add theirs. */
const queryableViews = ["runs"];

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
