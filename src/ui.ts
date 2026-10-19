import * as stylex from "@stylexjs/stylex";

type Style = stylex.StyleXStyles;

export function clsx(
	...styles: Array<Style | false | null | undefined>
): string {
	return stylex.props(...styles).className ?? "";
}

export function classToken(style: Style): string {
	return stylex.props(style).className ?? "";
}
