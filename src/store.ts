import { Database } from "bun:sqlite";
import type { Ticket } from "./domain.ts";
import type { Snapshot, Store } from "./ports.ts";

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
	return {
		store: {
			replaceTickets(rows) {
				db.transaction(() => {
					db.run("delete from snapshots");
					const insert = db.query(
						"insert into snapshots (snapshot_key, name, tracker, payload) values (?, ?, ?, ?)",
					);
					for (const row of rows) {
						insert.run(
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
				})();
			},
			readTickets() {
				const rows = db
					.query("select snapshot_key, name, tracker, payload from snapshots")
					.all() as {
					snapshot_key: string;
					name: string;
					tracker: Snapshot["tracker"];
					payload: string;
				}[];
				return rows.map((row) => {
					const payload = JSON.parse(row.payload) as {
						tickets: Ticket[];
						pulls: Snapshot["pulls"];
						branches: string[];
						startedKeys: string[];
					};
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
			},
		},
		close: () => db.close(),
	};
}
