import { Database } from "bun:sqlite";

import type { Board, Notification, Ticket, TrackerKind } from "./domain.ts";
import type { ValidatorStore } from "./github.ts";
import { mergeTickets } from "./poll-merge.ts";
import type { Snapshot, Store } from "./ports.ts";
import { listedRef, projectId } from "./project-ref.ts";

type StoredPayload = {
	tickets: Ticket[];
	pulls: Snapshot["pulls"];
	branches: string[];
	startedKeys: string[];
	board?: Board;
	host?: string;
	owner?: string;
	number?: number;
	listedEmpty?: boolean;
};

type StoredRow = {
	snapshot_key: string;
	name: string;
	tracker: Snapshot["tracker"];
	payload: string;
};

/** The payload text of each row that a store read or wrote. */
const payloadText = new WeakMap<Snapshot, string>();

function fromStored(row: StoredRow): Snapshot {
	const payload = JSON.parse(row.payload) as StoredPayload;
	const hostPrefix = payload.host === undefined ? 0 : payload.host.length + 1;
	const snapshot = {
		key: row.snapshot_key.slice(row.snapshot_key.indexOf(":") + 1 + hostPrefix),
		name: row.name,
		tracker: row.tracker,
		tickets: payload.tickets,
		pulls: payload.pulls,
		branches: payload.branches,
		startedKeys: payload.startedKeys,
		...(payload.board === undefined ? {} : { board: payload.board }),
		...(payload.host === undefined ? {} : { host: payload.host }),
		...(payload.owner === undefined ? {} : { owner: payload.owner }),
		...(payload.number === undefined ? {} : { number: payload.number }),
		...(payload.listedEmpty === undefined
			? {}
			: { listedEmpty: payload.listedEmpty }),
	};
	payloadText.set(snapshot, row.payload);
	return snapshot;
}

function readRows(db: Database): Snapshot[] {
	const rows = db
		.query("select snapshot_key, name, tracker, payload from snapshots")
		.all() as StoredRow[];
	return rows.map(fromStored);
}

function snapshotKey(row: Snapshot): string {
	const host = row.host === undefined ? "" : `${row.host}/`;
	return `${listedRef(row).kind}:${host}${row.key}`;
}

function toStored(row: Snapshot): StoredRow {
	return {
		snapshot_key: snapshotKey(row),
		name: row.name,
		tracker: row.tracker,
		payload:
			payloadText.get(row) ??
			JSON.stringify({
				tickets: row.tickets,
				pulls: row.pulls,
				branches: row.branches,
				startedKeys: row.startedKeys,
				...(row.board === undefined ? {} : { board: row.board }),
				...(row.host === undefined ? {} : { host: row.host }),
				...(row.owner === undefined ? {} : { owner: row.owner }),
				...(row.number === undefined ? {} : { number: row.number }),
				...(row.listedEmpty === undefined
					? {}
					: { listedEmpty: row.listedEmpty }),
			}),
	};
}

function writeRow(db: Database, row: StoredRow): void {
	db.query(
		"insert into snapshots (snapshot_key, name, tracker, payload) values (?, ?, ?, ?) on conflict(snapshot_key) do update set name = excluded.name, tracker = excluded.tracker, payload = excluded.payload",
	).run(row.snapshot_key, row.name, row.tracker, row.payload);
}

const busyTimeoutMs = 5_000;

export function sqliteStore(path: string): {
	store: Store;
	validators: ValidatorStore;
	close: () => void;
} {
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
	if (!notificationColumns.some((column) => column.name === "tracker")) {
		// Only GitHub and Linear wrote rows before this column, and only GitHub keys hold `#`.
		db.transaction(() => {
			db.run(
				"alter table notifications add column tracker text not null default ''",
			);
			db.run(
				"update notifications set tracker = case when instr(item_key, '#') > 0 then 'github' else 'linear' end",
			);
		})();
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
	let snapshotWrites = 0;
	const countSnapshotWrite = (_db: Database, table: string) => {
		if (table === "snapshots") {
			snapshotWrites += 1;
		}
	};
	db.onInsert = countSnapshotWrite;
	db.onUpdate = countSnapshotWrite;
	db.onDelete = countSnapshotWrite;
	let readAt: { snapshotWrites: number; rows: Snapshot[] } | null = null;
	return {
		store: {
			replaceTickets(rows) {
				const held =
					readAt?.snapshotWrites === snapshotWrites ? readAt.rows : null;
				const inPlace =
					held?.length === rows.length &&
					rows.every((row, position) => {
						const before = held[position];
						return (
							before !== undefined && snapshotKey(before) === snapshotKey(row)
						);
					});
				const changed = inPlace
					? rows.filter((row, position) => row !== held[position])
					: rows;
				if (inPlace && changed.length === 0) {
					return;
				}
				const stored = new Map(changed.map((row) => [row, toStored(row)]));
				db.transaction(() => {
					if (!inPlace) {
						// An unfiltered delete skips the row hooks.
						db.run("delete from snapshots where true");
					}
					for (const row of stored.values()) {
						writeRow(db, row);
					}
				})();
				readAt = {
					snapshotWrites,
					rows: rows.map((row) => {
						const written = stored.get(row);
						return written === undefined || payloadText.has(row)
							? row
							: fromStored(written);
					}),
				};
			},
			readTickets() {
				if (readAt?.snapshotWrites !== snapshotWrites) {
					readAt = { snapshotWrites, rows: readRows(db) };
				}
				return readAt.rows;
			},
			mergeTickets(rows) {
				db.transaction(() => {
					const stored = new Map(
						readRows(db).map((row) => [projectId(listedRef(row)), row]),
					);
					for (const row of rows) {
						const previous = stored.get(projectId(listedRef(row)));
						writeRow(
							db,
							toStored({
								...row,
								tickets: mergeTickets(previous?.tickets ?? [], row.tickets),
							}),
						);
					}
				})();
			},
			lastGoodPollAt(project) {
				const row = db
					.query("select fetched_at from project_polls where project = ?")
					.get(projectId(project)) as { fetched_at: string } | null;
				if (row === null) {
					return null;
				}
				return new Date(row.fetched_at);
			},
			recordGoodPoll(project, at) {
				const fetchedAt = at.toISOString();
				db.query(
					"insert into project_polls (project, fetched_at) values (?, ?) on conflict(project) do update set fetched_at = excluded.fetched_at",
				).run(projectId(project), fetchedAt);
				db.query(
					"update fetch_status set fetched_at = ?, error = null where id = 1",
				).run(fetchedAt);
			},
			forgetGoodPoll(project) {
				db.query("delete from project_polls where project = ?").run(
					projectId(project),
				);
			},
			recordFetchError(message) {
				db.query("update fetch_status set error = ? where id = 1").run(message);
			},
			recordProjectError(project, message) {
				db.query(
					"insert into project_errors (project, error) values (?, ?) on conflict(project) do update set error = excluded.error",
				).run(projectId(project), message);
			},
			clearProjectError(project) {
				db.query("delete from project_errors where project = ?").run(
					projectId(project),
				);
			},
			projectError(project) {
				const pending = db
					.query("select error from project_errors where project = ?")
					.get(projectId(project)) as { error: string } | null;
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
						"select id, trigger, project, tracker, item_key, text, at, read from notifications order by at desc, id desc",
					)
					.all() as {
					id: string;
					trigger: Notification["trigger"];
					project: string;
					tracker: TrackerKind;
					item_key: string;
					text: string;
					at: string;
					read: number;
				}[];
				return rows.map((row) => ({
					id: row.id,
					trigger: row.trigger,
					project: row.project,
					tracker: row.tracker,
					key: row.item_key,
					text: row.text,
					at: row.at,
					read: row.read !== 0,
				}));
			},
			appendNotifications(entries) {
				const insert = db.query(
					"insert or ignore into notifications (id, trigger, project, tracker, item_key, text, at, read) values (?, ?, ?, ?, ?, ?, ?, ?)",
				);
				db.transaction(() => {
					for (const entry of entries) {
						insert.run(
							entry.id,
							entry.trigger,
							entry.project,
							entry.tracker,
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
		},
		validators: {
			read() {
				return db
					.query("select url, etag, body, headers from validators")
					.all() as {
					url: string;
					etag: string;
					body: string;
					headers: string;
				}[];
			},
			record(url, etag, body, headers) {
				db.query(
					"insert into validators (url, etag, body, headers) values (?, ?, ?, ?) on conflict(url) do update set etag = excluded.etag, body = excluded.body, headers = excluded.headers",
				).run(url, etag, body, headers);
			},
		},
		close: () => db.close(),
	};
}
