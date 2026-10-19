import { Database } from "bun:sqlite";
import type { Notification, Ticket } from "./domain.ts";
import { mergeTickets } from "./domain.ts";
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
	db.run(`
		create table if not exists snapshots (
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
	db.run(`
		create table if not exists project_errors (
			project text primary key,
			error text not null
		)
	`);
	db.run(`
		create table if not exists notifications (
			id text primary key,
			trigger text not null,
			project text not null,
			item_key text not null,
			text text not null,
			at text not null
		)
	`);
	db.run(`
		create table if not exists seeded_ids (
			id text primary key
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
			recordProjectError(project, message) {
				db.query(
					"insert into project_errors (project, error) values (?, ?) on conflict(project) do update set error = excluded.error",
				).run(project, message);
			},
			clearProjectError(project) {
				db.query("delete from project_errors where project = ?").run(project);
			},
			projectError(project) {
				const pending = db
					.query("select error from project_errors where project = ?")
					.get(project) as { error: string } | null;
				return pending?.error ?? null;
			},
			fetchStatus() {
				const row = db
					.query("select fetched_at, error from fetch_status where id = 1")
					.get() as { fetched_at: string | null; error: string | null };
				return { fetchedAt: row.fetched_at, error: row.error };
			},
			readNotifications() {
				const rows = db
					.query(
						"select id, trigger, project, item_key, text, at from notifications order by at desc, id desc",
					)
					.all() as {
					id: string;
					trigger: Notification["trigger"];
					project: string;
					item_key: string;
					text: string;
					at: string;
				}[];
				return rows.map((row) => ({
					id: row.id,
					trigger: row.trigger,
					project: row.project,
					key: row.item_key,
					text: row.text,
					at: row.at,
				}));
			},
			appendNotifications(entries) {
				const insert = db.query(
					"insert or ignore into notifications (id, trigger, project, item_key, text, at) values (?, ?, ?, ?, ?, ?)",
				);
				db.transaction(() => {
					for (const entry of entries) {
						insert.run(
							entry.id,
							entry.trigger,
							entry.project,
							entry.key,
							entry.text,
							entry.at,
						);
					}
				})();
			},
			readSeededIds() {
				const rows = db.query("select id from seeded_ids").all() as {
					id: string;
				}[];
				return rows.map((row) => row.id);
			},
			recordSeededIds(ids) {
				const insert = db.query(
					"insert or ignore into seeded_ids (id) values (?)",
				);
				db.transaction(() => {
					for (const id of ids) {
						insert.run(id);
					}
				})();
			},
		},
		close: () => db.close(),
	};
}
