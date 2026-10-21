import type { Configuration } from "./configuration.ts";

export const overviewFilters = ["all", "needs-you", "blocked"] as const;

export const overviewSorts = [
	"project",
	"tracker",
	"progress",
	"backlog",
	"inProgress",
	"inReview",
	"awaitingMerge",
	"needsYou",
	"blockedBy",
] as const;

export const overviewDirections = ["asc", "desc"] as const;

export const overviewViews = ["cards", "graph", "table"] as const;

export type OverviewView = Configuration["overview"];
