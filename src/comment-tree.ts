import { commentHtml } from "./comment-html.ts";
import type { ThreadComment } from "./domain.ts";

export type FetchedComment = Omit<ThreadComment, "html">;

const htmlComment = /<!--[\s\S]*?-->/g;

function visibleCommentBody(body: string): string {
	return body
		.replace(htmlComment, "")
		.replace(/[ \t]+\n/g, "\n")
		.trim();
}

function visibleComment(comment: FetchedComment): ThreadComment {
	const body = visibleCommentBody(comment.body);
	return { ...comment, body, html: commentHtml(body), children: [] };
}

export function commentTree(comments: FetchedComment[]): ThreadComment[] {
	const byParent = new Map<string | null, ThreadComment[]>();
	for (const comment of comments) {
		const parent = comment.parentId;
		const list = byParent.get(parent) ?? [];
		list.push(visibleComment(comment));
		byParent.set(parent, list);
	}
	const attach = (comment: ThreadComment): ThreadComment => ({
		...comment,
		children: (byParent.get(comment.id) ?? []).map(attach),
	});
	return (byParent.get(null) ?? []).map(attach);
}
