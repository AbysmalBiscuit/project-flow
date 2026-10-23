import { Button } from "./button.tsx";
import { CommentMarkdown } from "./comment-markdown.tsx";
import type { NeedsYouItem, ThreadComment, TicketRelation } from "./domain.ts";
import { panel } from "./panel-styles.ts";
import {
	mergeFactLabel,
	openOnGitHubLabel,
	pullStatusLabel,
	whyLabel,
} from "./terms.ts";
import { itemId } from "./ticket-key.ts";
import { clsx } from "./ui.ts";
import { shell } from "./ui-styles.ts";

function commentTime(value: string): string {
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
	pending,
	picked,
	onPick,
}: {
	item: NeedsYouItem;
	pending: boolean;
	picked: boolean;
	onPick: (option: number) => void;
}) {
	const question = item.question;
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
								className={clsx(panel.factLink)}
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
							<button
								type="button"
								className={clsx(panel.option, shell.buttonFocus)}
								data-option={option.number}
								disabled={pending || picked || item.answered}
								onClick={() => onPick(option.number)}
							>
								<span className={clsx(panel.number)}>{option.number}</span>
								<span>{option.label}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
