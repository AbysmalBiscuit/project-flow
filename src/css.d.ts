type CssModule<Keys extends string> = { readonly [Key in Keys]: string };

declare module "*/cards.module.css" {
	const classes: CssModule<
		| "list"
		| "card"
		| "highlighted"
		| "projectLink"
		| "counts"
		| "count"
		| "swatch"
		| "done"
		| "dropped"
		| "blocked"
		| "backlog"
		| "inProgress"
		| "inReview"
		| "awaitingMerge"
		| "tags"
		| "blockers"
		| "chip"
		| "graph"
		| "mermaidHost"
		| "table"
		| "opened"
	>;
	export default classes;
}

declare module "*/shell.module.css" {
	const classes: CssModule<
		| "page"
		| "title"
		| "heading"
		| "nav"
		| "link"
		| "button"
		| "stale"
		| "back"
		| "theme"
	>;
	export default classes;
}

declare module "*/project.module.css" {
	const classes: CssModule<
		| "section"
		| "summary"
		| "legend"
		| "legendItem"
		| "swatch"
		| "done"
		| "dropped"
		| "blocked"
		| "backlog"
		| "inProgress"
		| "inReview"
		| "awaitingMerge"
		| "theme"
		| "dashed"
		| "tickets"
		| "ticket"
		| "ticketOpen"
		| "highlighted"
		| "diagram"
		| "nodes"
		| "dashedNode"
		| "reportNav"
	>;
	export default classes;
}

declare module "*/needs.module.css" {
	const classes: CssModule<
		"list" | "item" | "answered" | "headline" | "open" | "tag" | "project"
	>;
	export default classes;
}

declare module "*/panel.module.css" {
	const classes: CssModule<
		| "panel"
		| "close"
		| "thread"
		| "comment"
		| "body"
		| "reply"
		| "text"
		| "error"
		| "tracker"
	>;
	export default classes;
}

declare module "*.css";
