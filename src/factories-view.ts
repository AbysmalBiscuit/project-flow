/** The day ranges a reader can pick for the outcome chart and the stage durations. */
export const rangeDays = [7, 14, 30, 90] as const;

export type RangeDays = (typeof rangeDays)[number];

/** The days of the outcome chart, today included, when the reader picks none. */
export const outcomeDays: RangeDays = 14;

/** The days of run history that the stall rule covers, and the stage durations when the reader picks none. */
export const stageDays: RangeDays = 30;

/** The rows on one page of a Factories tab list that a reader can pick. */
export const pageSizes = [5, 10, 20, 50] as const;

export type PageSize = (typeof pageSizes)[number];

/** The Factories tab lists that show one page of rows at a time. */
export const pagedLists = ["running", "attention", "queue"] as const;

export type PagedList = (typeof pagedLists)[number];

export const defaultPageSize: PageSize = 10;

export type FactoriesView = {
	outcomeDays: RangeDays;
	stageDays: RangeDays;
	pageSize: Record<PagedList, PageSize>;
};

export const factoriesViewDefaults: FactoriesView = {
	outcomeDays,
	stageDays,
	pageSize: {
		running: defaultPageSize,
		attention: defaultPageSize,
		queue: defaultPageSize,
	},
};
