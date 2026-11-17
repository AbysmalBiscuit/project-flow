import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { PageLoading } from "./loading.tsx";
import { pageQuery } from "./queries-page.ts";
import { PageFrame } from "./shell.tsx";
import { navLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { Card, Sources } from "./verification-card.tsx";
import { ChecksTable, NotServed, Reasons } from "./verification-checks.tsx";
import { PickedRun } from "./verification-run.tsx";
import { styles } from "./verification-styles.ts";
import { Tiles } from "./verification-tiles.tsx";
import { verificationCopy } from "./workflows-terms.ts";

const pickedRun = (): string | null =>
	new URLSearchParams(window.location.search).get("run");

export function Page() {
	const query = useQuery(pageQuery.verification);
	const [picked, setPicked] = useState(pickedRun);
	const page = query.data;
	const pick = (id: string) => {
		const url = new URL(window.location.href);
		url.searchParams.set("run", id);
		window.history.replaceState(null, "", url);
		setPicked(id);
	};
	const runId = picked ?? page?.runs[0]?.id ?? null;
	return (
		<PageFrame
			title={navLabel.verification}
			subtitle={verificationCopy.subtitle}
		>
			{page === undefined ? (
				<PageLoading />
			) : (
				<>
					<Tiles tiles={page.tiles} />
					<div className={clsx(styles.grid, styles.two)}>
						<Card
							title={verificationCopy.checks}
							head={
								<Sources
									route={verificationCopy.sources.route}
									store={verificationCopy.sources.aggregate}
								/>
							}
						>
							<ChecksTable checks={page.checks} />
							<NotServed factories={page.notServed} />
						</Card>
						<Card
							title={verificationCopy.reasons}
							head={<Sources store={verificationCopy.sources.store} />}
						>
							<Reasons reasons={page.reasons} />
						</Card>
					</div>
					{runId === null ? (
						<Card
							title={verificationCopy.run}
							head={<Sources route={verificationCopy.sources.route} />}
						>
							<p className={clsx(styles.empty)}>{verificationCopy.noRuns}</p>
							<NotServed factories={page.notServed} />
						</Card>
					) : (
						<PickedRun runId={runId} runs={page.runs} pick={pick} />
					)}
				</>
			)}
		</PageFrame>
	);
}
