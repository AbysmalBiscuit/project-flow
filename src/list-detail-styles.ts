import * as stylex from "@stylexjs/stylex";

import { colours, measure, media, space } from "./tokens.stylex.ts";

/** The list-and-detail layout: a list, and a sticky pane that shows the picked row. */
export const listDetail = stylex.create({
	split: {
		display: "grid",
		gridTemplateColumns: {
			default: "minmax(0, 1fr) minmax(0, 1.1fr)",
			[media.phone]: "minmax(0, 1fr)",
		},
		gap: space.lg,
		alignItems: "start",
	},
	/** Space above a section that follows a card. */
	belowCard: { marginTop: space.lg },
	sticky: {
		position: { default: "sticky", [media.phone]: "static" },
		top: space.lg,
		maxHeight: { default: measure.stickyPane, [media.phone]: "none" },
		overflowY: "auto",
	},
	rowPicked: {
		backgroundColor: colours.rowOn,
		boxShadow: `inset ${measure.underline} 0 0 ${colours.accent}`,
	},
});
