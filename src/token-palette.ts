import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StatusType } from "./domain.ts";

function statePalette(source: string): Map<string, string> {
	const values = new Map<string, string>();
	let open = false;
	for (const line of source.split("\n")) {
		if (line.startsWith("export const stateValues = {")) {
			open = true;
			continue;
		}
		if (open && line === "};") {
			break;
		}
		if (!open) {
			continue;
		}
		const match = line.match(
			/^\t([A-Za-z][A-Za-z0-9]*): "(#[0-9A-Fa-f]{6})",$/,
		);
		const name = match?.[1];
		const value = match?.[2];
		if (name !== undefined && value !== undefined) {
			values.set(name, value);
		}
	}
	return values;
}

const palette = statePalette(
	readFileSync(resolve(import.meta.dir, "tokens.stylex.ts"), "utf8"),
);

function statusColour(status: StatusType): string {
	const value = palette.get(status);
	if (value === undefined) {
		throw new Error(`missing status colour ${status}`);
	}
	return value;
}

export const statusColours = {
	backlog: statusColour("backlog"),
	inProgress: statusColour("inProgress"),
	inReview: statusColour("inReview"),
	awaitingMerge: statusColour("awaitingMerge"),
	done: statusColour("done"),
	dropped: statusColour("dropped"),
} as const satisfies Record<StatusType, string>;
