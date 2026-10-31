import { z } from "zod";

import { ownerRepo } from "./project-ref.ts";

/** A repo on a declared Forgejo host. Forgejo has no home host, so each pin names its host. */
export const forgejoPin = z.strictObject({
	tracker: z.literal("forgejo"),
	repo: z.string().regex(ownerRepo),
	host: z.string().trim().toLowerCase().min(1),
});
