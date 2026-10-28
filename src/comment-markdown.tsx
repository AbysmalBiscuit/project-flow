import { commentBody } from "./comment-styles.ts";
import { textControl } from "./control-styles.ts";
import { clsx } from "./ui.ts";

type Tag =
	| "h1"
	| "h2"
	| "h3"
	| "h4"
	| "h5"
	| "h6"
	| "p"
	| "ul"
	| "ol"
	| "blockquote"
	| "pre"
	| "table"
	| "th"
	| "td"
	| "a"
	| "input";

const tagClass = {
	h1: clsx(commentBody.heading),
	h2: clsx(commentBody.heading),
	h3: clsx(commentBody.heading),
	h4: clsx(commentBody.heading),
	h5: clsx(commentBody.heading),
	h6: clsx(commentBody.heading),
	p: clsx(commentBody.paragraph),
	ul: clsx(commentBody.list),
	ol: clsx(commentBody.list),
	blockquote: clsx(commentBody.quote),
	pre: clsx(commentBody.pre),
	table: clsx(commentBody.table),
	th: clsx(commentBody.cell),
	td: clsx(commentBody.cell),
	a: clsx(commentBody.link, ...textControl),
	input: clsx(commentBody.check),
} satisfies Record<Tag, string>;

const checkWrap = clsx(commentBody.checkWrap);
const checkedMark = clsx(commentBody.checked);

const inlineCode = clsx(commentBody.code);
const tagPattern = new RegExp(
	`<(${Object.keys(tagClass).join("|")})(?=[\\s>])`,
	"g",
);

function styled(html: string): string {
	return html
		.split("\n")
		.map((line) => {
			const tagged = line
				.replace(
					tagPattern,
					(_match, tag: Tag) => `<${tag} class="${tagClass[tag]}"`,
				)
				.replace(/<span(?= data-check="")/g, `<span class="${checkWrap}"`)
				.replace(/<span(?= data-checked="")/g, `<span class="${checkedMark}"`);
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
			className={clsx(commentBody.body)}
			data-comment-body=""
			// biome-ignore lint/security/noDangerouslySetInnerHtml: comment HTML is rendered and sanitized on the server
			dangerouslySetInnerHTML={{ __html: styled(html) }}
		/>
	);
}
