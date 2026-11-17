import { useQuery } from "@tanstack/react-query";

import { BoxBands } from "./factories-boxes.tsx";
import { OutcomeChart, StageTable } from "./factories-chart.tsx";
import { PageSizePicker, usePaged } from "./factories-paging.tsx";
import { Card, RangePicker, styles } from "./factories-parts.tsx";
import {
	AttentionList,
	NotServed,
	QueueTable,
	RunningTable,
} from "./factories-tables.tsx";
import { factoriesCopy } from "./factories-terms.ts";
import { Tiles } from "./factories-tiles.tsx";
import {
	type FactoriesView,
	factoriesViewDefaults,
	type PagedList,
	type PageSize,
} from "./factories-view.ts";
import { PageLoading } from "./loading.tsx";
import { pageQueryClient } from "./queries-client.ts";
import { pageQuery } from "./queries-page.ts";
import { useSaveSettings } from "./queries-settings.ts";
import { configurationOf } from "./queries-shapes.ts";
import { PageFrame } from "./shell.tsx";
import { navLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { useNow } from "./use-now.ts";

export function Page() {
	const settings = useQuery({ ...pageQuery.settings, select: configurationOf });
	if (settings.data === undefined) {
		return (
			<PageFrame title={navLabel.factories} subtitle={factoriesCopy.subtitle}>
				<PageLoading />
			</PageFrame>
		);
	}
	return (
		<FactoriesBody
			view={settings.data?.factoriesView ?? factoriesViewDefaults}
		/>
	);
}

function FactoriesBody({ view }: { view: FactoriesView }) {
	const save = useSaveSettings({ refetchProjects: false, optimistic: true });
	const saveView = (change: Partial<FactoriesView>) => {
		void save
			.mutateAsync((current) => ({
				...current,
				factoriesView: { ...current.factoriesView, ...change },
			}))
			.catch(() => pageQueryClient.invalidateQueries(pageQuery.settings));
	};
	const sizeOf = (list: PagedList) => ({
		size: view.pageSize[list],
		onChange: (size: PageSize) =>
			saveView({ pageSize: { ...view.pageSize, [list]: size } }),
	});
	const outcomes = view.outcomeDays;
	const stages = view.stageDays;
	const query = useQuery(pageQuery.factories(outcomes, stages));
	const now = useNow(1_000);
	const page = query.data;
	const running = usePaged(
		factoriesCopy.running,
		page?.running ?? [],
		view.pageSize.running,
	);
	const attention = usePaged(
		factoriesCopy.attention,
		page?.attention ?? [],
		view.pageSize.attention,
	);
	const queue = usePaged(
		factoriesCopy.queue,
		page?.queue ?? [],
		view.pageSize.queue,
	);
	return (
		<PageFrame title={navLabel.factories} subtitle={factoriesCopy.subtitle}>
			{page === undefined ? (
				<PageLoading />
			) : (
				<>
					<Tiles page={page} now={now} />
					<BoxBands page={page} now={now} />
					<div className={clsx(styles.grid, styles.two)}>
						<Card
							title={factoriesCopy.running}
							source={factoriesCopy.sources.running}
							stretch
							tools={
								<PageSizePicker
									list="running"
									title={factoriesCopy.running}
									{...sizeOf("running")}
								/>
							}
						>
							<div className={clsx(styles.grow)}>
								<RunningTable
									runs={running.rows}
									blank={running.blank}
									now={now}
								/>
							</div>
							{running.pager}
							<p className={clsx(styles.note)}>{factoriesCopy.runningNote}</p>
						</Card>
						<Card
							title={factoriesCopy.attention}
							source={factoriesCopy.sources.attention}
							stretch
							tools={
								<PageSizePicker
									list="attention"
									title={factoriesCopy.attention}
									{...sizeOf("attention")}
								/>
							}
						>
							<div className={clsx(styles.grow)}>
								<AttentionList
									items={attention.rows}
									blank={attention.blank}
									now={now}
								/>
							</div>
							{attention.pager}
						</Card>
					</div>
					<div className={clsx(styles.grid)}>
						<Card
							title={factoriesCopy.outcomes}
							aggregate={factoriesCopy.sources.outcomes}
							tools={
								<RangePicker
									id="factories-outcome-days"
									chart={factoriesCopy.outcomes}
									days={outcomes}
									onChange={(outcomeDays) => saveView({ outcomeDays })}
								/>
							}
						>
							<OutcomeChart days={page.outcomes} />
						</Card>
						<Card
							title={factoriesCopy.stageDurations}
							source={factoriesCopy.sources.stageEvents}
							aggregate={factoriesCopy.sources.stageAggregate}
							tools={
								<RangePicker
									id="factories-stage-days"
									chart={factoriesCopy.stageDurations}
									days={stages}
									onChange={(stageDays) => saveView({ stageDays })}
								/>
							}
						>
							<StageTable stages={page.stages} days={stages} />
						</Card>
						<Card
							title={factoriesCopy.queue}
							source={factoriesCopy.sources.queue}
							tools={
								<PageSizePicker
									list="queue"
									title={factoriesCopy.queue}
									{...sizeOf("queue")}
								/>
							}
						>
							<QueueTable items={queue.rows} now={now} />
							{queue.pager}
							<NotServed page={page} panel="queue" />
						</Card>
					</div>
				</>
			)}
		</PageFrame>
	);
}
