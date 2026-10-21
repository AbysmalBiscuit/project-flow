import { clsx } from "./ui.ts";
import { panel } from "./ui-styles.ts";

const safeLink = /^(?:https?|mailto:)/i;

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
	code: clsx(panel.mdCode),
};

const dropped = new Set([
	"script",
	"style",
	"iframe",
	"object",
	"embed",
	"link",
	"meta",
	"base",
	"form",
	"img",
	"svg",
	"math",
]);

const markdownOptions = {
	noHtmlBlocks: true,
	noHtmlSpans: true,
	tagFilter: true,
	headings: { ids: false },
} as const;

function sanitize(html: string): string {
	const parents: string[] = [];
	return new HTMLRewriter()
		.on("*", {
			element(element) {
				parents.push(element.tagName);
				element.onEndTag(() => {
					parents.pop();
				});
				if (dropped.has(element.tagName)) {
					element.remove();
					return;
				}
				const named = tagClass[element.tagName];
				if (
					named !== undefined &&
					(element.tagName !== "code" || parents.at(-2) !== "pre")
				) {
					element.setAttribute("class", named);
				}
				for (const [name] of [...element.attributes]) {
					if (name.toLowerCase().startsWith("on")) {
						element.removeAttribute(name);
					}
				}
				if (element.tagName === "input") {
					element.setAttribute("disabled", "");
					element.removeAttribute("formaction");
					return;
				}
				if (element.tagName !== "a") {
					return;
				}
				const href = element.getAttribute("href") ?? "";
				if (!safeLink.test(href)) {
					element.removeAndKeepContent();
					return;
				}
				element.setAttribute("target", "_blank");
				element.setAttribute("rel", "noopener noreferrer");
			},
			comments(comment) {
				comment.remove();
			},
		})
		.transform(html);
}

export function commentHtml(body: string): string {
	return sanitize(Bun.markdown.html(body, markdownOptions));
}
