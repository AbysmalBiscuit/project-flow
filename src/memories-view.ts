/** The state tabs of the Memories page. `all` shows every memory. */
export const memoryTabs = [
	"all",
	"conflicting",
	"unverified",
	"verified",
	"suppressed",
	"superseded",
] as const;

export type MemoryTab = (typeof memoryTabs)[number];

export type MemoriesView = { tab: MemoryTab };

export const memoriesViewDefaults: MemoriesView = { tab: "all" };
