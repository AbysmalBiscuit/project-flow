import { useQuery } from "@tanstack/react-query";

import type { ShownFactoryRun } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import { pageQuery } from "./queries.ts";
import { agentToolLabel, agentTurnLabel, runAgentsLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

/** What each agent of a live run does now: its stage, turn, current tool and last message. */
export function RunAgents({ run }: { run: ShownFactoryRun }) {
	const { data } = useQuery(pageQuery.agents(run));
	if (data === undefined || data.length === 0) {
		return null;
	}
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runAgentsLabel}</h3>
			<ul className={clsx(panel.relations)} aria-label={runAgentsLabel}>
				{data.map((agent) => (
					<li
						key={agent.stage}
						className={clsx(panel.agent)}
						data-agent={agent.stage}
						data-turn={agent.turn}
					>
						<span className={clsx(panel.relation)}>
							<span className={clsx(panel.currentStage)}>{agent.stage}</span>
							<span className={clsx(panel.key)}>
								{agentTurnLabel[agent.turn]}
							</span>
							{agent.tool === null ? null : (
								<span className={clsx(panel.key)}>
									{agentToolLabel(agent.tool)}
								</span>
							)}
						</span>
						{agent.lastMessage === null ? null : (
							<span className={clsx(panel.agentMessage)}>
								{agent.lastMessage}
							</span>
						)}
					</li>
				))}
			</ul>
		</>
	);
}
