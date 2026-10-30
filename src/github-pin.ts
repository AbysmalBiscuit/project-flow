import { z } from "zod";

import { ownerRepo } from "./project-ref.ts";

export const githubHost = "github.com";

const githubRepoPin = z
	.strictObject({
		tracker: z.literal("github"),
		repo: z.string().regex(ownerRepo),
		host: z.string().trim().toLowerCase().min(1).optional(),
	})
	.transform(({ host, ...pin }) =>
		host === undefined || host === githubHost ? pin : { ...pin, host },
	);

const githubProjectPin = z.strictObject({
	tracker: z.literal("github"),
	owner: z.string().regex(/^[^/\s]+$/),
	project: z.number().int().positive(),
});

/**
 * The tracked forms of a GitHub project. A repo pin with no host is on github.com.
 * A discriminated union reads `tracker` from the input of this pipe, and a plain union shows it no value.
 */
export const githubPin = z
	.looseObject({ tracker: z.literal("github") })
	.pipe(z.union([githubRepoPin, githubProjectPin]));
