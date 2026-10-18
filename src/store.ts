import { Database } from "bun:sqlite";
import type { Ticket } from "./domain.ts";
import type { Store } from "./ports.ts";

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
			writeTickets(repo, tickets) {
				db.run(
					"insert or replace into snapshots (repo, payload) values (?, ?)",
					[repo, JSON.stringify(tickets)],
				);
			},
			readTickets() {
				const rows = db
					.query("select repo, payload from snapshots order by repo")
					.all() as {
					repo: string;
					payload: string;
				}[];
				return rows.map((row) => ({
					repo: row.repo,
					tickets: JSON.parse(row.payload) as Ticket[],
				}));
			},
		},
		close: () => db.close(),
	};
}
