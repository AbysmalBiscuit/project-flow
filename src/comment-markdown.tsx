import { clsx } from "./ui.ts";
import { panel } from "./ui-styles.ts";

const tagClass: Record<string, string> = {
	h1: clsx(panel.mdHeading),
	h2: clsx(panel.mdHeading),
	h3: clsx(panel.mdHeading),
	h4: clsx(panel.mdHeading),
	h5: clsx(panel.mdHeading),
	h6: clsx(panel.mdHeading),
	ul: clsx(panel.mdList),
	ol: clsx(panel.mdList),
	blockquote: clsx(panel.mdQuote),
	pre: clsx(panel.mdPre),
	table: clsx(panel.mdTable),
	th: clsx(panel.mdCell),
	td: clsx(panel.mdCell),
	a: clsx(panel.mdLink),
};

const inlineCode = clsx(panel.mdCode);

function styled(html: string): string {
	return html
		.split("\n")
		.map((line) => {
			const tagged = line.replace(
				/<(h[1-6]|ul|ol|blockquote|pre|table|th|td|a)(?=[\s>])/g,
				(match, tag: string) => {
					const name = tagClass[tag];
					return name === undefined ? match : `<${tag} class="${name}"`;
				},
			);
			if (line.includes("</pre>") || line.includes("<pre")) {
				return tagged;
			}
			return tagged.replace(/<code(?=[\s>])/g, `<code class="${inlineCode}"`);
		})
		.join("\n");
}

export function CommentMarkdown({ html }: { html: string }) {
	return (
		<div
			className={clsx(panel.body)}
			data-comment-body=""
			// The server renders GitHub-flavoured markdown and drops raw HTML.
			dangerouslySetInnerHTML={{ __html: styled(html) }}
		/>
	);
}
