import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PageLoading } from "./loading.tsx";
import { retroPagePath } from "./page-links.ts";
import { pageQuery } from "./queries-page.ts";
import { Card, NotServed, Source } from "./retros-parts.tsx";
import { FrictionGroups, RunRetroCard } from "./retros-run.tsx";
import { pickedRun, RunsTable } from "./retros-runs.tsx";
import { styles } from "./retros-styles.ts";
import { Segment } from "./segment.tsx";
import { PageFrame } from "./shell.tsx";
import { navLabel } from "./terms.ts";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";
import { retrosCopy } from "./workflows-terms.ts";

export function Page() {
	const [roughOrWorse, setRoughOrWorse] = useState(false);
	const [picked, setPicked] = useState(pickedRun);
	const query = useQuery(pageQuery.retros(roughOrWorse));
	const page = query.data;
	const shown = picked ?? page?.runs[0]?.id ?? null;
	const pick = (id: string) => {
		setPicked(id);
		window.history.replaceState(null, "", retroPagePath(id));
	};
	return (
		<PageFrame title={navLabel.retros} subtitle={retrosCopy.subtitle}>
			{page === undefined ? (
				<PageLoading />
			) : (
				<div className={clsx(styles.grid, styles.two)}>
					<Card
						title={retrosCopy.runs}
						head={
							<>
								<span className={clsx(headerControlStyle.group)}>
									<Segment
										label={retrosCopy.all}
										on={!roughOrWorse}
										onClick={() => setRoughOrWorse(false)}
									/>
									<Segment
										label={retrosCopy.roughOrWorse}
										on={roughOrWorse}
										onClick={() => setRoughOrWorse(true)}
									/>
								</span>
								<Source>{retrosCopy.sources.route}</Source>
							</>
						}
					>
						<RunsTable
							runs={page.runs}
							picked={shown}
							onPick={pick}
							roughOrWorse={roughOrWorse}
						/>
						<NotServed page={page} />
					</Card>
					<Card
						title={retrosCopy.friction}
						head={<Source store>{retrosCopy.sources.aggregate}</Source>}
					>
						<FrictionGroups groups={page.friction} />
					</Card>
				</div>
			)}
			{shown === null ? null : <RunRetroCard runId={shown} />}
		</PageFrame>
	);
}
