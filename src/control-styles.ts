import * as stylex from "@stylexjs/stylex";

import {
	colours,
	font,
	measure,
	radius,
	space,
	stateTone,
	type,
} from "./tokens.stylex.ts";

const focusRing = `${measure.focus} solid ${colours.focus}` as const;

// A filled control keeps its fill, so hover and press lay a veil of its ink
// over it. The ink contrasts with the fill in both themes, so the veil shows on
// a dark fill and on a light fill.
const hoverInk = "color-mix(in srgb, currentColor 14%, transparent)";
const pressInk = "color-mix(in srgb, currentColor 28%, transparent)";
const filledPress = {
	default: null,
	":not(:disabled):not(:active):hover": `linear-gradient(${hoverInk}, ${hoverInk})`,
	":not(:disabled):active": `linear-gradient(${pressInk}, ${pressInk})`,
} as const;

// StyleX gives compound conditions one priority, so hover excludes `:active`.
const pressFill = {
	":not(:disabled):not(:active):hover": colours.rowHover,
	":not(:disabled):active": colours.controlPress,
} as const;

/**
 * The box that `Button`, `TextInput` and `Select` share, so controls in one
 * row line up. The other styles give every clickable control its hover, press,
 * focus and disabled looks.
 */
export const control = stylex.create({
	box: {
		boxSizing: "border-box",
		height: measure.control,
		margin: 0,
		padding: `0 ${space.md}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.controlLine,
		borderRadius: radius.menu,
		backgroundColor: colours.controlFill,
		color: colours.controlInk,
		fontFamily: font.sans,
		fontSize: type.menu,
		fontWeight: type.regular,
		lineHeight: 1,
	},
	off: {
		opacity: {
			default: null,
			":disabled": 0.5,
		},
		cursor: {
			default: "pointer",
			":disabled": "not-allowed",
		},
	},
	/**
	 * The disabled look of a control inside a group, such as a segment. The
	 * group fades as a whole, so the control fades only on its own.
	 */
	offInGroup: {
		cursor: {
			default: "pointer",
			":disabled": "not-allowed",
		},
	},
	/** The disabled look of a control group: a `fieldset` fades with its controls. */
	groupOff: {
		opacity: {
			default: null,
			":disabled": 0.5,
		},
		cursor: {
			default: null,
			":disabled": "not-allowed",
		},
	},
	/** A control with the control fill at rest. */
	press: {
		backgroundColor: { default: colours.controlFill, ...pressFill },
	},
	/** A control with no fill at rest: a menu item, a segment or a list row. */
	clear: {
		backgroundColor: { default: "transparent", ...pressFill },
	},
	/** The on state of a toggle, a tab or the current link. */
	on: {
		backgroundColor: { default: colours.segment, ...pressFill },
		color: colours.ink,
		fontWeight: type.weight,
	},
	/** A control with the segment fill at rest, such as a pill. */
	soft: {
		backgroundColor: { default: colours.segment, ...pressFill },
	},
	/** A card that opens as a whole, on the page fill. */
	card: {
		backgroundColor: { default: colours.page, ...pressFill },
	},
	/** The current link of a contents list, on the muted surface fill. */
	current: {
		backgroundColor: { default: colours.surfaceMuted, ...pressFill },
		color: colours.ink,
		fontWeight: type.weight,
	},
	/** A card that opens as a whole, on the surface fill of a graph. */
	graphCard: {
		backgroundColor: { default: colours.surface, ...pressFill },
	},
	/** A card in the wash of its state. */
	tonedCard: {
		backgroundColor: { default: stateTone.wash, ...pressFill },
	},
	/** The chosen row of a table keeps its fill under the pointer. */
	chosen: {
		backgroundColor: {
			default: colours.rowOn,
			":not(:disabled):not(:active):hover": colours.rowOn,
			":not(:disabled):active": colours.controlPress,
		},
	},
	/** A link in running text. */
	link: {
		color: { default: "inherit", ":hover": colours.link },
	},
	/** Room for the hover fill around a bare text control, with no layout shift. */
	bleed: {
		margin: `calc(-1 * ${space.twoXs}) calc(-1 * ${space.xs})`,
		padding: `${space.twoXs} ${space.xs}`,
		borderRadius: radius.sm,
	},
	/** A slider over a colour gradient takes a ring, because a fill would change its colours. */
	slider: {
		boxShadow: {
			default: null,
			":hover": `0 0 0 ${measure.hairline} ${colours.inkSoft}`,
			":active": `0 0 0 ${measure.focus} ${colours.inkSoft}`,
		},
	},
	/** A control with a coloured fill at rest, such as a chip. */
	tint: {
		backgroundImage: filledPress,
	},
	focus: {
		outline: {
			default: "none",
			":focus-visible": focusRing,
		},
		outlineOffset: space.twoXs,
	},
	/** The focus ring of a frame round a field, such as a search box with a glyph. */
	focusWithin: {
		outline: {
			default: "none",
			":focus-within": focusRing,
		},
		outlineOffset: space.twoXs,
	},
	/** The focus ring inside the box, for a control in a row that clips overflow. */
	focusInside: {
		outline: {
			default: "none",
			":focus-visible": focusRing,
		},
		outlineOffset: `calc(-1 * ${measure.focus})`,
	},
	primary: {
		borderColor: colours.needs,
		backgroundColor: colours.needs,
		color: colours.needsInk,
		fontWeight: type.weight,
		backgroundImage: filledPress,
	},
	danger: {
		borderColor: colours.danger,
		backgroundColor: colours.danger,
		color: colours.accentInk,
		fontWeight: type.weight,
		backgroundImage: filledPress,
	},
});

/** The fills, bleed and focus ring of a bare text link. */
export const textControl = [
	control.clear,
	control.bleed,
	control.focus,
] as const;
