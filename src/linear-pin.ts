import { z } from "zod";

/** The tracked form of a Linear project. */
export const linearPin = z.strictObject({
	tracker: z.literal("linear"),
	project: z.string().regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/),
});
