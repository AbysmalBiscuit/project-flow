import { z } from "zod";

export const gitlabHost = "gitlab.com";

/** The path of a GitLab repo: its group and subgroups, then its name. */
export const gitlabRepoPath = /^[^/\s#]+(?:\/[^/\s#]+)+$/;

/** The tracked form of a GitLab repo on gitlab.com. */
export const gitlabPin = z.strictObject({
	tracker: z.literal("gitlab"),
	repo: z.string().regex(gitlabRepoPath),
});
