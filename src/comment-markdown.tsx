import { clsx } from "./ui.ts";
import { panel } from "./ui-styles.ts";

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
	| "input"
	| "span";

const tagClass = {
	h1: clsx(panel.mdHeading),
	h2: clsx(panel.mdHeading),
	h3: clsx(panel.mdHeading),
	h4: clsx(panel.mdHeading),
	h5: clsx(panel.mdHeading),
	h6: clsx(panel.mdHeading),
	p: clsx(panel.mdParagraph),
	ul: clsx(panel.mdList),
	ol: clsx(panel.mdList),
	blockquote: clsx(panel.mdQuote),
	pre: clsx(panel.mdPre),
	table: clsx(panel.mdTable),
	th: clsx(panel.mdCell),
	td: clsx(panel.mdCell),
	a: clsx(panel.mdLink),
	input: clsx(panel.mdCheck),
	span: clsx(panel.mdChecked),
} satisfies Record<Tag, string>;

const inlineCode = clsx(panel.mdCode);
const tagPattern = new RegExp(
	`<(${Object.keys(tagClass).join("|")})(?=[\\s>])`,
	"g",
);

function styled(html: string): string {
	return html
		.split("\n")
		.map((line) => {
			const tagged = line.replace(
				tagPattern,
				(_match, tag: Tag) => `<${tag} class="${tagClass[tag]}"`,
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
			// biome-ignore lint/security/noDangerouslySetInnerHtml: comment HTML is rendered and sanitized on the server
			dangerouslySetInnerHTML={{ __html: styled(html) }}
		/>
	);
}
