import { Database } from "bun:sqlite";
import type { Ticket } from "./domain.ts";
import type { Snapshot, Store } from "./ports.ts";

export function sqliteStore(path: string): { store: Store; close: () => void } {
	const db = new Database(path);
	db.run(`
		create table if not exists snapshots (
			repo text primary key,
			tracker text not null default 'github',
			payload text not null
		)
	`);
	const columns = db
		.query("select name from pragma_table_info('snapshots')")
		.all() as { name: string }[];
	if (!columns.some((column) => column.name === "tracker")) {
		db.run(
			"alter table snapshots add column tracker text not null default 'github'",
		);
	}
	return {
		store: {
			replaceTickets(rows) {
				db.transaction(() => {
					db.run("delete from snapshots");
					const insert = db.query(
						"insert into snapshots (repo, tracker, payload) values (?, ?, ?)",
					);
					for (const row of rows) {
						insert.run(
							row.project,
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
					.query("select repo, tracker, payload from snapshots")
					.all() as {
					repo: string;
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
						project: row.repo,
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
