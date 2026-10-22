import * as stylex from "@stylexjs/stylex";
import { Expand, ExternalLink, type LucideIcon, Shrink, X } from "lucide-react";
import { colours, measure, radius, space, type } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { shell } from "./ui-styles.ts";

const icons = {
	expand: Expand,
	"external-link": ExternalLink,
	shrink: Shrink,
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
		boxSizing: "border-box",
		height: measure.button,
		padding: `0 ${space.sm}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.menu,
		backgroundColor: {
			default: "transparent",
			":hover": colours.segment,
		},
		color: {
			default: colours.inkSoft,
			":hover": colours.ink,
		},
		fontSize: type.meta,
		lineHeight: 1,
		textDecoration: "none",
		whiteSpace: "nowrap",
		cursor: "pointer",
	},
	iconOnly: {
		width: measure.button,
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
});

type Content =
	| { icon: IconName; label?: never; name: string }
	| { label: string; icon?: IconName; name?: string };

type Action = { href: string; onClick?: never } | { onClick: () => void };

type ButtonProps = Content &
	Action & {
		iconSide?: "left" | "right";
	};

/**
 * One control height for every mix of icon and label. `name`, when given,
 * sets the accessible name and the tooltip. An icon-only button requires it.
 */
export function Button(props: ButtonProps) {
	const { icon, label, name, iconSide = "left" } = props;
	const Icon = icon === undefined ? null : icons[icon];
	const className = clsx(
		styles.button,
		label === undefined && styles.iconOnly,
		iconSide === "right" && styles.iconRight,
		shell.buttonFocus,
	);
	const content = (
		<>
			{Icon === null ? null : (
				<Icon className={clsx(styles.icon)} aria-hidden="true" />
			)}
			{label}
		</>
	);
	if ("href" in props) {
		return (
			<a className={className} href={props.href} aria-label={name} title={name}>
				{content}
			</a>
		);
	}
	return (
		<button
			type="button"
			className={className}
			aria-label={name}
			title={name}
			onClick={props.onClick}
		>
			{content}
		</button>
	);
}
