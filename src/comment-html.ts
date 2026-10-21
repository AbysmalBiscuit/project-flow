const safeLink = /^(?:https?:|mailto:)/i;

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
	autolinks: true,
	headings: { ids: false },
} as const;

function sanitize(html: string): string {
	return new HTMLRewriter()
		.on("*", {
			element(element) {
				if (dropped.has(element.tagName)) {
					if (element.tagName === "img") {
						const alt = element.getAttribute("alt") ?? "";
						if (alt !== "") {
							element.before(alt, { html: false });
						}
					}
					element.remove();
					return;
				}
				for (const [name] of [...element.attributes]) {
					if (name.toLowerCase().startsWith("on")) {
						element.removeAttribute(name);
					}
				}
				if (element.tagName === "input") {
					element.setAttribute("disabled", "");
					element.removeAttribute("formaction");
					if (element.getAttribute("checked") !== null) {
						element.after('<span data-checked="">[x] </span>', {
							html: true,
						});
					}
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
