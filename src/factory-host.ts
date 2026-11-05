import { z } from "zod";

/** The answer of a factory's `GET /machine`: the CPU, memory, disks and uptime of its host. */
export const hostSnapshot = z.object({
	taken_at: z.string(),
	uptime_seconds: z.number(),
	cpu: z.object({
		cores: z.number(),
		load_1m: z.number(),
		load_5m: z.number(),
		load_15m: z.number(),
		busy_percent: z.number(),
		iowait_percent: z.number(),
	}),
	memory: z.object({
		total_bytes: z.number(),
		available_bytes: z.number(),
		swap_total_bytes: z.number(),
		swap_used_bytes: z.number(),
	}),
	disks: z.array(
		z.object({
			mount: z.string(),
			holds: z.array(z.string()),
			total_bytes: z.number(),
			used_bytes: z.number(),
			free_bytes: z.number(),
		}),
	),
});

export type HostSnapshot = z.infer<typeof hostSnapshot>;

/** The route of the host snapshot. */
export const hostRoute = "/machine";

/** How often Project Flow samples the host route of each factory. */
export const hostSampleMs = 15_000;

/** The states of a box in the box pool of a hub. */
export const boxStates = [
	"awake",
	"asleep",
	"waking",
	"stopping",
	"unreachable",
] as const;

export type BoxState = (typeof boxStates)[number];

/** The answer of a hub's `GET /machines/pool`: the state, slots and host snapshot of each box. */
export const boxPool = z.object({
	machines: z.array(
		z.object({
			name: z.string(),
			state: z.enum(boxStates),
			drained: z.boolean(),
			slots: z.object({ total: z.number(), used: z.number() }),
			last_contact: z.string().nullable(),
			snapshot: hostSnapshot.nullable(),
		}),
	),
});

export type PoolBox = z.infer<typeof boxPool>["machines"][number];

/** The route of the box pool. */
export const poolRoute = "/machines/pool";

/** The pool entry of the hub's own daemon, which the hub card already shows. */
export const ownPoolBox = "local";
