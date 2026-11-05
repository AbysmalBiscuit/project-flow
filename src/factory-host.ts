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
