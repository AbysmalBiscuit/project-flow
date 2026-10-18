import { Database } from "bun:sqlite";
import type { PullRequest, Ticket } from "./domain.ts";
import type { Snapshot, Store } from "./ports.ts";

export function sqliteStore(path: string): { store: Store; close: () => void } {
	const db = new Database(path);
	db.run(`
		create table if not exists snapshots (
			repo text primary key,
			payload text not null
		)
	`);
	return {
		store: {
			replaceTickets(rows) {
				db.transaction(() => {
					db.run("delete from snapshots");
					const insert = db.query(
						"insert into snapshots (repo, payload) values (?, ?)",
					);
					for (const row of rows) {
						insert.run(row.project, JSON.stringify(row));
					}
				})();
			},
			readTickets() {
				const rows = db
					.query("select repo, payload from snapshots order by repo")
					.all() as {
					repo: string;
					payload: string;
				}[];
				return rows.map((row) => {
					const payload = JSON.parse(row.payload) as
						| Ticket[]
						| (Snapshot & { pulls?: PullRequest[] });
					if (Array.isArray(payload)) {
						return {
							project: row.repo,
							tickets: payload,
							pulls: [],
							branches: [],
							startedKeys: [],
						};
					}
					return {
						project: row.repo,
						tickets: payload.tickets,
						pulls: payload.pulls ?? [],
						branches: payload.branches ?? [],
						startedKeys: payload.startedKeys ?? [],
					};
				});
			},
		},
		close: () => db.close(),
	};
}
