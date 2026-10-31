import type { ReactNode } from "react";

import { board, runDotTone } from "./board-styles.ts";
import { Button } from "./button.tsx";
import { Choice } from "./choice.tsx";
import { CommentMarkdown } from "./comment-markdown.tsx";
import { textControl } from "./control-styles.ts";
import type {
	EarlierFactoryRun,
	NeedsYouItem,
	ShownFactoryRun,
	ThreadComment,
	TicketRelation,
} from "./domain.ts";
import { runPagePath } from "./page-links.ts";
import { panel } from "./panel-styles.ts";
import { spanLabel } from "./poll-age.ts";
import { RunAgents } from "./run-agents.tsx";
import { RunCurrentStage } from "./run-checkpoint.tsx";
import { RunDot } from "./run-marks.tsx";
import {
	earlierRunsLabel,
	hubQueueLabel,
	mergeFactLabel,
	noStartLabel,
	openOnGitHubLabel,
	openRunLabel,
	pullStatusLabel,
	runFactLabel,
	runNotLiveLabel,
	runSectionLabel,
	runStatusLabel,
	whyLabel,
} from "./terms.ts";
import { itemId } from "./ticket-key.ts";
import { clsx } from "./ui.ts";

export function commentTime(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return "";
	}
	return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function CommentTree({
	comments,
	nested,
	onReply,
}: {
	comments: ThreadComment[];
	nested: boolean;
	onReply: (comment: ThreadComment) => void;
}) {
	return (
		<ul className={clsx(panel.thread)}>
			{comments.map((comment) => (
				<li
					key={comment.id}
					className={clsx(panel.comment)}
					data-comment={comment.id}
				>
					<p className={clsx(panel.who)}>
						<span>{comment.author}</span>
						<span>{commentTime(comment.createdAt)}</span>
					</p>
					<CommentMarkdown html={comment.html} />
					{nested || comment.kind === "review" ? (
						<Button
							label="Answer"
							layout={panel.answer}
							onClick={() => onReply(comment)}
						/>
					) : null}
					{comment.children.length === 0 ? null : (
						<CommentTree
							comments={comment.children}
							nested={true}
							onReply={onReply}
						/>
					)}
				</li>
			))}
		</ul>
	);
}

export function runTime(value: string | null): string {
	if (value === null) {
		return noStartLabel;
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return "";
	}
	return parsed.toLocaleString([], {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function elapsed(run: EarlierFactoryRun): string | null {
	const started =
		run.startedAt === null ? Number.NaN : Date.parse(run.startedAt);
	const ended = run.endedAt === null ? Date.now() : Date.parse(run.endedAt);
	return Number.isNaN(started) || Number.isNaN(ended)
		? null
		: spanLabel(started, ended);
}

export function RunFact({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className={clsx(panel.fact)}>
			<dt className={clsx(panel.factLabel)}>{label}</dt>
			<dd className={clsx(panel.factValue)}>{children}</dd>
		</div>
	);
}

/** The newest factory run of a ticket, then its earlier runs with status and time. */
export function RunSection({
	run,
	earlier,
	pull,
	pullUrl,
}: {
	run: ShownFactoryRun;
	earlier: EarlierFactoryRun[];
	pull: string | undefined;
	pullUrl: string | undefined;
}) {
	const span = elapsed(run);
	return (
		<section
			className={clsx(panel.section)}
			aria-label={runSectionLabel}
			data-run={run.statusKind}
			data-run-live={run.coveredByFeed ? "true" : "false"}
		>
			<h3 className={clsx(panel.sectionLabel)}>{runSectionLabel}</h3>
			{run.coveredByFeed ? null : (
				<p className={clsx(panel.note)}>{runNotLiveLabel}</p>
			)}
			<dl className={clsx(panel.facts)}>
				<RunFact label={runFactLabel.status}>
					<span className={clsx(panel.runStatus)}>
						{run.coveredByFeed ? <RunDot run={run} /> : null}
						{runStatusLabel[run.statusKind]}
					</span>
				</RunFact>
				{run.stage === undefined ? null : (
					<RunFact label={runFactLabel.stage}>{run.stage}</RunFact>
				)}
				<RunFact label={runFactLabel.box}>{run.box ?? hubQueueLabel}</RunFact>
				<RunFact label={runFactLabel.factory}>{run.factory}</RunFact>
				<RunFact label={runFactLabel.start}>{runTime(run.startedAt)}</RunFact>
				{span === null ? null : (
					<RunFact label={runFactLabel.elapsed}>{span}</RunFact>
				)}
				{pullUrl === undefined ? null : (
					<RunFact label={runFactLabel.pr}>
						<a className={clsx(panel.factLink, ...textControl)} href={pullUrl}>
							{pull ?? openOnGitHubLabel}
						</a>
					</RunFact>
				)}
			</dl>
			<a
				className={clsx(panel.openRun, ...textControl)}
				href={runPagePath(run.id)}
				data-open-run={run.id}
			>
				{openRunLabel}
			</a>
			<RunCurrentStage run={run} />
			<RunAgents run={run} />
			{earlier.length === 0 ? null : (
				<>
					<h3 className={clsx(panel.sectionLabel)}>{earlierRunsLabel}</h3>
					<ul className={clsx(panel.relations)} aria-label={earlierRunsLabel}>
						{earlier.map((item) => (
							<li
								key={`${item.statusKind}-${item.startedAt}-${item.endedAt}`}
								className={clsx(panel.relation)}
								data-earlier-run={item.statusKind}
							>
								<span
									className={clsx(board.runDot, runDotTone[item.statusKind])}
								/>
								<span>{runStatusLabel[item.statusKind]}</span>
								<span className={clsx(panel.key)}>
									{runTime(item.startedAt)}
								</span>
							</li>
						))}
					</ul>
				</>
			)}
		</section>
	);
}

export function RelationList({
	label,
	relations,
	onOpen,
}: {
	label: string;
	relations: TicketRelation[];
	onOpen: (blocker: TicketRelation) => void;
}) {
	if (relations.length === 0) {
		return null;
	}
	return (
		<section className={clsx(panel.section)} aria-label={label}>
			<h3 className={clsx(panel.sectionLabel)}>{label}</h3>
			<ul className={clsx(panel.relations)}>
				{relations.map((blocker) => (
					<li
						key={itemId(blocker.project, blocker.key)}
						className={clsx(panel.relation)}
					>
						<Button
							label={blocker.key}
							data-blocker={blocker.key}
							onClick={() => onOpen(blocker)}
						/>
						{blocker.title === blocker.key ? null : (
							<span>{blocker.title}</span>
						)}
					</li>
				))}
			</ul>
		</section>
	);
}

export function WhySection({
	item,
	run,
	pending,
	picked,
	onPick,
}: {
	item: NeedsYouItem;
	/** The run whose thread the panel shows. */
	run: ShownFactoryRun | undefined;
	pending: boolean;
	picked: boolean;
	onPick: (option: number) => void;
}) {
	const ask = item.factoryAsk;
	const askInThread =
		ask !== undefined &&
		ask.run === run?.id &&
		run.thread?.some(({ question }) => question === ask.question) === true;
	const question = askInThread ? undefined : item.question;
	const options = item.options ?? [];
	const pull = item.pull;
	if (question === undefined && pull === undefined && options.length === 0) {
		return null;
	}
	return (
		<section className={clsx(panel.section)} aria-label={whyLabel}>
			<h3 className={clsx(panel.sectionLabel)}>{whyLabel}</h3>
			{question === undefined ? null : (
				<p className={clsx(panel.question)}>{question}</p>
			)}
			{pull === undefined ? null : (
				<dl className={clsx(panel.facts)}>
					<div className={clsx(panel.fact)}>
						<dt className={clsx(panel.factLabel)}>{mergeFactLabel.pr}</dt>
						<dd className={clsx(panel.factValue)}>
							<a
								className={clsx(panel.factLink, ...textControl)}
								href={pull.url}
								aria-label={`${openOnGitHubLabel}, PR #${pull.number}`}
							>
								{openOnGitHubLabel}
							</a>
							<span>
								#{pull.number} {pull.title}
							</span>
						</dd>
					</div>
					<div className={clsx(panel.fact)}>
						<dt className={clsx(panel.factLabel)}>{mergeFactLabel.ci}</dt>
						<dd className={clsx(panel.factValue)}>
							{pullStatusLabel.ci[pull.ci]}
						</dd>
					</div>
					<div className={clsx(panel.fact)}>
						<dt className={clsx(panel.factLabel)}>{mergeFactLabel.review}</dt>
						<dd className={clsx(panel.factValue)}>
							{pullStatusLabel.review[pull.review]}
						</dd>
					</div>
				</dl>
			)}
			{options.length === 0 ? null : (
				<ul className={clsx(panel.options)}>
					{options.map((option) => (
						<li key={option.number}>
							<Choice
								number={option.number}
								label={option.label}
								data-option={option.number}
								disabled={pending || picked || item.answered}
								onClick={() => onPick(option.number)}
							/>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
