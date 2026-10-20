import { Database } from "bun:sqlite";
import type { Board, Notification, Ticket } from "./domain.ts";
import { mergeTickets } from "./domain.ts";
import type { Snapshot, Store } from "./ports.ts";

type StoredPayload = {
	tickets: Ticket[];
	pulls: Snapshot["pulls"];
	branches: string[];
	startedKeys: string[];
	board?: Board;
	owner?: string;
	number?: number;
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
			...(payload.board === undefined ? {} : { board: payload.board }),
			...(payload.owner === undefined ? {} : { owner: payload.owner }),
			...(payload.number === undefined ? {} : { number: payload.number }),
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
			...(row.board === undefined ? {} : { board: row.board }),
			...(row.owner === undefined ? {} : { owner: row.owner }),
			...(row.number === undefined ? {} : { number: row.number }),
		}),
	);
}

const busyTimeoutMs = 5_000;

export function sqliteStore(path: string): { store: Store; close: () => void } {
	const db = new Database(path);
	db.run(`pragma busy_timeout = ${busyTimeoutMs}`);
	db.run("pragma journal_mode = WAL");
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
			at text not null,
			read integer not null default 0
		)
	`);
	const notificationColumns = db
		.query("pragma table_info(notifications)")
		.all() as { name: string }[];
	if (!notificationColumns.some((column) => column.name === "read")) {
		db.run(
			"alter table notifications add column read integer not null default 0",
		);
	}
	db.run(`
		create table if not exists seeded_ids (
			id text primary key
		)
	`);
	db.run(`
		create table if not exists validators (
			url text primary key,
			etag text not null,
			body text not null,
			headers text not null
		)
	`);
	const validatorColumns = db.query("pragma table_info(validators)").all() as {
		name: string;
	}[];
	if (!validatorColumns.some((column) => column.name === "body")) {
		db.run(
			"alter table validators add column body text not null default 'null'",
		);
	}
	if (!validatorColumns.some((column) => column.name === "headers")) {
		db.run(
			"alter table validators add column headers text not null default '[]'",
		);
	}
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
						"select id, trigger, project, item_key, text, at, read from notifications order by at desc, id desc",
					)
					.all() as {
					id: string;
					trigger: Notification["trigger"];
					project: string;
					item_key: string;
					text: string;
					at: string;
					read: number;
				}[];
				return rows.map((row) => ({
					id: row.id,
					trigger: row.trigger,
					project: row.project,
					key: row.item_key,
					text: row.text,
					at: row.at,
					read: row.read !== 0,
				}));
			},
			appendNotifications(entries) {
				const insert = db.query(
					"insert or ignore into notifications (id, trigger, project, item_key, text, at, read) values (?, ?, ?, ?, ?, ?, ?)",
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
							entry.read ? 1 : 0,
						);
					}
				})();
			},
			markNotificationRead(id) {
				const changed = db
					.query("update notifications set read = 1 where id = ?")
					.run(id);
				return changed.changes > 0;
			},
			markNotificationsRead(ids) {
				const mark = db.query("update notifications set read = 1 where id = ?");
				db.transaction(() => {
					for (const id of ids) {
						mark.run(id);
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
			forgetSeededIds(ids) {
				const remove = db.query("delete from seeded_ids where id = ?");
				db.transaction(() => {
					for (const id of ids) {
						remove.run(id);
					}
				})();
			},
			readValidators() {
				const rows = db
					.query("select url, etag, body, headers from validators")
					.all() as {
					url: string;
					etag: string;
					body: string;
					headers: string;
				}[];
				return rows;
			},
			recordValidator(url, etag, body, headers) {
				db.query(
					"insert into validators (url, etag, body, headers) values (?, ?, ?, ?) on conflict(url) do update set etag = excluded.etag, body = excluded.body, headers = excluded.headers",
				).run(url, etag, body, headers);
			},
			forgetValidator(url) {
				db.query("delete from validators where url = ?").run(url);
			},
		},
		close: () => db.close(),
	};
}
