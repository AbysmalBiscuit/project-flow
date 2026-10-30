import { json } from "./fetch.ts";
import type { LinearFake } from "./linear.ts";

type MoveVariables = {
	id?: string;
	labels?: string[];
	input?: {
		stateId?: string;
		addedLabelIds?: string[];
		removedLabelIds?: string[];
	};
};

/** The fake Linear answer to a state move query or mutation in `body`, or null for any other query. */
export function linearMoveAnswer(
	body: string,
	options: LinearFake,
): Response | null {
	const query = JSON.parse(body) as {
		query?: string;
		variables?: MoveVariables;
	};
	const variables = query.variables;
	if (query.query?.includes("ShownStateIds")) {
		const issue = (options.issues ?? []).find(
			(item) => item.identifier === variables?.id || item.id === variables?.id,
		);
		return json({
			data: {
				issue:
					issue === undefined
						? null
						: {
								id: issue.id,
								team: {
									...(issue.team as { id: string } | undefined),
									states: {
										nodes: (options.states ?? []).map(({ id, name }) => ({
											id,
											name,
										})),
									},
								},
							},
				issueLabels: {
					nodes: (options.labels ?? []).filter((label) =>
						variables?.labels?.includes(label.name),
					),
				},
			},
		});
	}
	if (!query.query?.includes("IssueShowState")) {
		return null;
	}
	const input = variables?.input;
	const issue = (options.issues ?? []).find(
		(item) => item.id === variables?.id,
	);
	const state = (options.states ?? []).find(
		(item) => item.id === input?.stateId,
	);
	if (issue === undefined || state === undefined) {
		return json({ data: { issueUpdate: { success: false, issue: null } } });
	}
	const nameOf = (labelId: string) =>
		(options.labels ?? []).find((label) => label.id === labelId)?.name;
	const removed = new Set((input?.removedLabelIds ?? []).map(nameOf));
	const held = (
		(issue.labels as { nodes?: { name: string }[] } | undefined)?.nodes ?? []
	).filter((label) => !removed.has(label.name));
	const added = (input?.addedLabelIds ?? []).flatMap((labelId) => {
		const name = nameOf(labelId);
		return name === undefined ? [] : [{ name }];
	});
	issue.state = {
		id: state.id,
		name: state.name,
		type: state.type,
		color: state.color,
	};
	issue.labels = { nodes: [...held, ...added] };
	return json({
		data: {
			issueUpdate: {
				success: true,
				issue: { state: issue.state, labels: issue.labels },
			},
		},
	});
}
