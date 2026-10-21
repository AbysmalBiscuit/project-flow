import { clsx } from "./ui.ts";
import { panel } from "./ui-styles.ts";

export function CommentMarkdown({ html }: { html: string }) {
	return (
		<div
			className={clsx(panel.body)}
			data-comment-body=""
			// The server renders GitHub-flavoured markdown and drops raw HTML.
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
