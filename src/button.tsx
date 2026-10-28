import * as stylex from "@stylexjs/stylex";
import {
	Bell,
	Check,
	Expand,
	ExternalLink,
	ListFilter,
	type LucideIcon,
	Map as MapIcon,
	Pin,
	PinOff,
	Search,
	Shrink,
	SlidersHorizontal,
	X,
} from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

import { control } from "./control-styles.ts";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { shell } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

const icons = {
	bell: Bell,
	check: Check,
	expand: Expand,
	"external-link": ExternalLink,
	filter: ListFilter,
	map: MapIcon,
	pin: Pin,
	"pin-off": PinOff,
	search: Search,
	shrink: Shrink,
	sliders: SlidersHorizontal,
	x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

const styles = stylex.create({
	button: {
		display: "inline-flex",
		flexShrink: 0,
		gap: space.xs,
		alignItems: "center",
		justifyContent: "center",
		textDecoration: "none",
		whiteSpace: "nowrap",
	},
	pressed: {
		backgroundColor: colours.segment,
		color: colours.ink,
		fontWeight: type.weight,
	},
	iconOnly: {
		width: measure.control,
		padding: 0,
	},
	iconRight: {
		flexDirection: "row-reverse",
	},
	icon: {
		flexShrink: 0,
		width: measure.buttonIcon,
		height: measure.buttonIcon,
	},
	count: {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		minWidth: measure.badge,
		padding: `0 ${space.xs}`,
		borderRadius: radius.pill,
		backgroundColor: colours.segment,
		color: colours.ink,
		fontSize: type.kicker,
		lineHeight: 1,
	},
});

type Content =
	| { icon: IconName; label?: never; name: string }
	| { label: string; icon?: IconName | undefined; name?: string };

type Link = { href: string; newTab?: boolean };

type Native = Omit<
	ComponentPropsWithoutRef<"button">,
	| "children"
	| "className"
	| "style"
	| "title"
	| "type"
	| "aria-label"
	| "aria-pressed"
> & { href?: never; submit?: boolean };

type ButtonProps = Content &
	(Link | Native) & {
		iconSide?: "left" | "right";
		tone?: "primary" | "danger";
		/** Marks a toggle button and shows its on state. */
		pressed?: boolean;
		/** A count badge after the label. */
		count?: number | undefined;
		/** The place of the button in its row or column. */
		layout?: stylex.StyleXStyles<{
			alignSelf?: "flex-start" | "center" | "flex-end";
			marginTop?: string;
			marginLeft?: string;
		}>;
	};

/**
 * One control height for every mix of icon and label. `name`, when given,
 * sets the accessible name and the tooltip. An icon-only button requires it.
 */
export function Button(props: ButtonProps) {
	const {
		icon,
		label,
		name,
		iconSide = "left",
		tone,
		pressed,
		count,
		layout,
	} = props;
	const Icon = icon === undefined ? null : icons[icon];
	const className = clsx(
		control.box,
		control.off,
		control.press,
		styles.button,
		tone === "primary" && control.primary,
		tone === "danger" && control.danger,
		pressed === true && styles.pressed,
		label === undefined && styles.iconOnly,
		iconSide === "right" && styles.iconRight,
		shell.buttonFocus,
		layout,
	);
	const content = (
		<>
			{Icon === null ? null : (
				<Icon className={clsx(styles.icon)} aria-hidden="true" />
			)}
			{label}
			{count === undefined ? null : (
				<span className={clsx(styles.count)}>{count}</span>
			)}
		</>
	);
	if (props.href !== undefined) {
		return (
			<a
				className={className}
				href={props.href}
				aria-label={name}
				title={name}
				{...(props.newTab === true
					? { target: "_blank", rel: "noopener noreferrer" }
					: {})}
			>
				{content}
			</a>
		);
	}
	const {
		icon: _icon,
		label: _label,
		name: _name,
		iconSide: _iconSide,
		tone: _tone,
		pressed: _pressed,
		count: _count,
		layout: _layout,
		href: _href,
		submit,
		...native
	} = props;
	return (
		<button
			{...native}
			type={submit === true ? "submit" : "button"}
			className={className}
			aria-label={name}
			aria-pressed={pressed}
			title={name}
		>
			{content}
		</button>
	);
}
