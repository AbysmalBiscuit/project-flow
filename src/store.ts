import { Database } from "bun:sqlite";
import { mergeTickets } from "./domain.ts";
import type { Ticket } from "./domain.ts";
import type { Snapshot, Store } from "./ports.ts";

type StoredPayload = {
	tickets: Ticket[];
	pulls: Snapshot["pulls"];
	branches: string[];
	startedKeys: string[];
};

function readRows(db: Database): Snapshot[] {
	const rows = db
		.query("select snapshot_key, name, tracker, payload from snapshots")
		.all() as {
		snapshot_key: string;
		name: string;
		tracker: Snapshot["tracker"];
		payload: string;
	}[];
	return rows.map((row) => {
		const payload = JSON.parse(row.payload) as StoredPayload;
		return {
			key: row.snapshot_key.slice(row.tracker.length + 1),
			name: row.name,
			tracker: row.tracker,
			tickets: payload.tickets,
			pulls: payload.pulls,
			branches: payload.branches,
			startedKeys: payload.startedKeys,
		};
	});
}

function writeRow(db: Database, row: Snapshot): void {
	db.query(
		"insert into snapshots (snapshot_key, name, tracker, payload) values (?, ?, ?, ?) on conflict(snapshot_key) do update set name = excluded.name, tracker = excluded.tracker, payload = excluded.payload",
	).run(
		`${row.tracker}:${row.key}`,
		row.name,
		row.tracker,
		JSON.stringify({
			tickets: row.tickets,
			pulls: row.pulls,
			branches: row.branches,
			startedKeys: row.startedKeys,
		}),
	);
}

export function sqliteStore(path: string): { store: Store; close: () => void } {
	const db = new Database(path);
	db.run("drop table if exists snapshots");
	db.run(`
		create table snapshots (
			snapshot_key text primary key,
			name text not null,
			tracker text not null,
			payload text not null
		)
	`);
	db.run(`
		create table if not exists fetch_status (
			id integer primary key check (id = 1),
			fetched_at text,
			error text
		)
	`);
	db.run("insert or ignore into fetch_status (id) values (1)");
	db.run(`
		create table if not exists project_polls (
			project text primary key,
			fetched_at text not null
		)
	`);
	return {
		store: {
			replaceTickets(rows) {
				db.transaction(() => {
					db.run("delete from snapshots");
					for (const row of rows) {
						writeRow(db, row);
					}
				})();
			},
			readTickets() {
				return readRows(db);
			},
			mergeTickets(rows) {
				db.transaction(() => {
					const stored = new Map(readRows(db).map((row) => [row.key, row]));
					for (const row of rows) {
						const previous = stored.get(row.key);
						writeRow(db, {
							...row,
							tickets: mergeTickets(previous?.tickets ?? [], row.tickets),
						});
					}
				})();
			},
			lastGoodPollAt(project) {
				const row = db
					.query("select fetched_at from project_polls where project = ?")
					.get(project) as { fetched_at: string } | null;
				if (row === null) {
					return null;
				}
				return new Date(row.fetched_at);
			},
			recordGoodPoll(project, at) {
				const fetchedAt = at.toISOString();
				db.query(
					"insert into project_polls (project, fetched_at) values (?, ?) on conflict(project) do update set fetched_at = excluded.fetched_at",
				).run(project, fetchedAt);
				db.query(
					"update fetch_status set fetched_at = ?, error = null where id = 1",
				).run(fetchedAt);
			},
			recordFetchError(message) {
				db.query("update fetch_status set error = ? where id = 1").run(message);
			},
			fetchStatus() {
				const row = db
					.query("select fetched_at, error from fetch_status where id = 1")
					.get() as { fetched_at: string | null; error: string | null };
				return { fetchedAt: row.fetched_at, error: row.error };
			},
		},
		close: () => db.close(),
	};
}
