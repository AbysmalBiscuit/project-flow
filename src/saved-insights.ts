import type { Database } from "bun:sqlite";

/** An insight query that Lev saved with a name. */
export type SavedInsight = { id: number; name: string; sql: string };

export type SavedInsights = { queries: SavedInsight[] };

/** The insight queries that a fresh store starts with, keyed by a stable id. Each one gives a label column and a number column. */
const startingInsights: {
	key: string;
	name: string;
	sql: string;
	/** Earlier SQL of the insight. A stored insight that still holds it gets `sql`, and an edited one stays. */
	replaces?: string[];
}[] = [
	{
		key: "cost-per-merged-pr-by-week",
		name: "Cost per merged PR by week",
		sql: `SELECT strftime('%Y-W%W', ended_at) AS week,
       round(total(cost_usd) / sum(result = 'merged'), 2) AS cost_per_merge
FROM runs
WHERE ended_at > date('now', '-56 days')
GROUP BY week HAVING sum(result = 'merged') > 0 ORDER BY week;`,
	},
	{
		key: "failure-reasons-30-days",
		name: "Failure reasons, 30 days",
		sql: `SELECT coalesce(reason, 'no reason') AS failure_reason,
       count(*) AS runs
FROM runs
WHERE result = 'failed' AND ended_at > date('now', '-30 days')
GROUP BY failure_reason
ORDER BY runs DESC;`,
	},
	{
		key: "run-results-by-day-14-days",
		name: "Run results by day, 14 days",
		sql: `SELECT date(ended_at) || ' ' || result AS day_result,
       count(*) AS runs
FROM runs
WHERE result IS NOT NULL AND ended_at > date('now', '-14 days')
GROUP BY day_result
ORDER BY day_result;`,
	},
	{
		key: "cost-by-project-30-days",
		name: "Cost by project, 30 days",
		sql: `SELECT coalesce(project, 'no project') AS run_project,
       round(total(cost_usd), 2) AS cost_usd
FROM runs
WHERE submitted_at > date('now', '-30 days')
GROUP BY run_project
ORDER BY cost_usd DESC;`,
	},
	{
		key: "median-run-duration-by-week",
		name: "Median run duration by week",
		sql: `WITH ended AS (
  SELECT strftime('%Y-W%W', ended_at) AS week,
         (julianday(ended_at) - julianday(started_at)) * 1440 AS minutes
  FROM runs
  WHERE started_at IS NOT NULL AND ended_at > date('now', '-56 days')
), ranked AS (
  SELECT week, minutes,
         row_number() OVER (PARTITION BY week ORDER BY minutes) AS position,
         count(*) OVER (PARTITION BY week) AS total
  FROM ended
)
SELECT week, round(avg(minutes), 1) AS median_minutes
FROM ranked
WHERE position IN ((total + 1) / 2, (total + 2) / 2)
GROUP BY week
ORDER BY week;`,
	},
	{
		key: "merge-rate-by-factory-30-days",
		name: "Merge rate by factory, 30 days",
		sql: `SELECT factory,
       round(100.0 * sum(result = 'merged') / count(*), 1) AS merge_rate_pct
FROM runs
WHERE ended_at > date('now', '-30 days')
GROUP BY factory
ORDER BY merge_rate_pct DESC;`,
	},
	{
		key: "most-expensive-runs-30-days",
		name: "Most expensive runs, 30 days",
		sql: `SELECT ticket || ', ' || coalesce(result, status) || ', ' ||
         coalesce(cast(round((julianday(ended_at) - julianday(started_at)) * 1440) AS integer) || ' min', 'not ended') AS run,
       round(cost_usd, 2) AS cost_usd
FROM runs
WHERE cost_usd IS NOT NULL AND submitted_at > date('now', '-30 days')
ORDER BY cost_usd DESC
LIMIT 10;`,
	},
	{
		key: "slowest-stages-by-p95",
		name: "Slowest stages by p95",
		sql: `WITH timed AS (
  SELECT stage, duration_s / 60.0 AS minutes,
         row_number() OVER (PARTITION BY stage ORDER BY duration_s) AS position,
         count(*) OVER (PARTITION BY stage) AS total
  FROM stages
  WHERE event = 'stage.completed' AND duration_s IS NOT NULL
    AND julianday(at) >= julianday('now', '-30 days')
)
SELECT stage, round(min(minutes), 1) AS p95_minutes
FROM timed
WHERE position >= 0.95 * total
GROUP BY stage
ORDER BY p95_minutes DESC;`,
		replaces: [
			`WITH timed AS (
  SELECT stage, duration_s / 60.0 AS minutes,
         row_number() OVER (PARTITION BY stage ORDER BY duration_s) AS position,
         count(*) OVER (PARTITION BY stage) AS total
  FROM stages
  WHERE event IN ('stage.completed', 'stage.failed') AND duration_s IS NOT NULL
)
SELECT stage, round(min(minutes), 1) AS p95_minutes
FROM timed
WHERE position >= 0.95 * total
GROUP BY stage
ORDER BY p95_minutes DESC;`,
		],
	},
	{
		key: "retries-by-stage-30-days",
		name: "Retries by stage, 30 days",
		sql: `SELECT stage,
       round(1.0 * sum(event = 'stage.retrying') / count(DISTINCT run_id), 2) AS retries_per_run
FROM stages
WHERE at > date('now', '-30 days')
GROUP BY stage
ORDER BY retries_per_run DESC;`,
	},
	{
		key: "cost-by-stage-30-days",
		name: "Cost by stage, 30 days",
		sql: `SELECT turns.stage AS stage,
       round(total(turns.cost_usd), 2) AS cost_usd
FROM turns
JOIN runs ON runs.id = turns.run_id
WHERE runs.submitted_at > date('now', '-30 days')
GROUP BY turns.stage
ORDER BY cost_usd DESC;`,
	},
	{
		key: "cost-by-model-30-days",
		name: "Cost by model, 30 days",
		sql: `SELECT coalesce(turns.model, 'unknown') AS model,
       round(total(turns.cost_usd), 2) AS cost_usd
FROM turns
JOIN runs ON runs.id = turns.run_id
WHERE runs.submitted_at > date('now', '-30 days')
GROUP BY model
ORDER BY cost_usd DESC;`,
	},
];

/** The saved insight queries: user data that a run history refill does not touch. */
export function savedInsights(
	db: Database,
	prepares: (sql: string) => boolean,
) {
	db.run(`
		create table if not exists saved_queries (
			id integer primary key autoincrement,
			starting text unique,
			name text not null,
			sql text not null,
			deleted_at text
		)
	`);
	const seed = db.query<unknown, [string, string, string]>(
		"insert or ignore into saved_queries (starting, name, sql) values (?, ?, ?)",
	);
	const listed = db.query<SavedInsight, []>(
		"select id, name, sql from saved_queries where deleted_at is null order by id",
	);
	const one = db.query<SavedInsight, [number]>(
		"select id, name, sql from saved_queries where id = ? and deleted_at is null",
	);
	const seeded = db.query<{ starting: string }, []>(
		"select starting from saved_queries where starting is not null",
	);
	/** Add each starting insight that is not in the store yet and whose tables and columns exist. */
	const seedStarting = () => {
		const done = new Set(seeded.all().map((row) => row.starting));
		db.transaction(() => {
			for (const insight of startingInsights) {
				if (!done.has(insight.key) && prepares(insight.sql)) {
					seed.run(insight.key, insight.name, insight.sql);
				}
			}
		})();
	};
	const replace = db.query<unknown, [string, string, string]>(
		"update saved_queries set sql = ? where starting = ? and sql = ?",
	);
	db.transaction(() => {
		for (const insight of startingInsights) {
			for (const earlier of insight.replaces ?? []) {
				replace.run(insight.sql, insight.key, earlier);
			}
		}
	})();
	// The store seeds when it opens, so the starting insights list before Lev's own queries.
	seedStarting();
	return {
		list(): SavedInsights {
			seedStarting();
			return { queries: listed.all() };
		},
		save(name: string, sql: string): SavedInsight {
			const { lastInsertRowid } = db
				.query("insert into saved_queries (name, sql) values (?, ?)")
				.run(name, sql);
			return { id: Number(lastInsertRowid), name, sql };
		},
		/** Change the name or SQL of a saved query. Null when no such query exists. */
		change(
			id: number,
			patch: { name?: string | undefined; sql?: string | undefined },
		): SavedInsight | null {
			const before = one.get(id);
			if (before === null) {
				return null;
			}
			const after = {
				id,
				name: patch.name ?? before.name,
				sql: patch.sql ?? before.sql,
			};
			db.query("update saved_queries set name = ?, sql = ? where id = ?").run(
				after.name,
				after.sql,
				id,
			);
			return after;
		},
		/** Delete a saved query, and keep its row so a starting insight does not come back. False when no such query exists. */
		remove(id: number, at: string): boolean {
			return (
				db
					.query(
						"update saved_queries set deleted_at = ? where id = ? and deleted_at is null",
					)
					.run(at, id).changes > 0
			);
		},
	};
}

export type SavedInsightStore = ReturnType<typeof savedInsights>;
