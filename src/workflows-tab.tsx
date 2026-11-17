import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { textControl } from "./control-styles.ts";
import { pageQuery } from "./queries-page.ts";
import { PageFrame } from "./shell.tsx";
import { navLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { useNow } from "./use-now.ts";
import { Card, newestShown, versionKey } from "./workflows-cards.tsx";
import { Detail } from "./workflows-detail.tsx";
import { styles } from "./workflows-styles.ts";
import { workflowsCopy } from "./workflows-terms.ts";

export function Page() {
	const page = useQuery(pageQuery.workflows).data;
	const cards = page?.cards;
	const now = useNow(60_000);
	const [picked, setPicked] = useState<string | null>(null);
	const [older, setOlder] = useState(false);
	const card = cards?.find((item) => versionKey(item) === picked) ?? cards?.[0];
	const folded = cards?.filter(
		(item, index) => index < newestShown || item.runs === 0,
	);
	const hidden = (cards?.length ?? 0) - (folded?.length ?? 0);
	const shown = older ? cards : folded;
	return (
		<PageFrame title={navLabel.workflows} subtitle={workflowsCopy.subtitle}>
			{cards === undefined ? null : cards.length === 0 ? (
				<p className={clsx(styles.empty)}>{workflowsCopy.empty}</p>
			) : (
				<>
					<div className={clsx(styles.cards)}>
						{(shown ?? cards).map((item) => (
							<Card
								key={versionKey(item)}
								card={item}
								reading={page?.reading ?? false}
								picked={
									card !== undefined && versionKey(card) === versionKey(item)
								}
								now={now}
								onPick={() => setPicked(versionKey(item))}
							/>
						))}
					</div>
					{hidden === 0 ? null : (
						<p className={clsx(styles.more)}>
							<button
								type="button"
								className={clsx(styles.moreButton, ...textControl)}
								aria-expanded={older}
								onClick={() => setOlder(!older)}
							>
								{older
									? workflowsCopy.hideOlder
									: workflowsCopy.showOlder(hidden)}
							</button>
						</p>
					)}
					{card === undefined ? null : <Detail card={card} />}
				</>
			)}
		</PageFrame>
	);
}
