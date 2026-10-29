import * as stylex from "@stylexjs/stylex";
import { useState } from "react";

import { control } from "./control-styles.ts";
import { Segment } from "./segment.tsx";
import {
	graphDirectionLabel,
	graphLayoutLabel,
	graphLayoutTip,
} from "./terms.ts";
import {
	colours,
	measure,
	radius,
	space,
	stack,
	type,
} from "./tokens.stylex.ts";
import { cards, headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";
import {
	type GraphDirection,
	graphDirections,
	type GraphLayoutKind,
	graphLayouts,
} from "./view-settings.ts";

const tip = stylex.create({
	anchor: {
		position: "relative",
		display: "inline-flex",
		height: "100%",
	},
	bubble: {
		position: "absolute",
		zIndex: stack.jump,
		bottom: `calc(100% + ${space.sm})`,
		left: 0,
		width: "max-content",
		maxWidth: measure.tip,
		padding: `${space.xs} ${space.sm}`,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.sm,
		backgroundColor: colours.raised,
		boxShadow: `0 0 ${space.md} ${colours.shadow}`,
		color: colours.ink,
		fontSize: type.meta,
		whiteSpace: "normal",
		pointerEvents: "none",
	},
});

/** Each layout button shows what its layout does on hover or focus. */
export function LayoutSwitch({
	layout,
	onChange,
}: {
	layout: GraphLayoutKind;
	onChange: (layout: GraphLayoutKind) => void;
}) {
	const [shown, setShown] = useState<GraphLayoutKind | null>(null);
	const hide = () => setShown(null);
	return (
		<fieldset className={clsx(headerControlStyle.group)}>
			<legend className={clsx(cards.graphProbe)}>Graph layout</legend>
			{graphLayouts.map((item) => (
				<span key={item} className={clsx(tip.anchor)}>
					<Segment
						id={`graph-layout-${item}`}
						label={graphLayoutLabel[item]}
						on={layout === item}
						aria-describedby={`graph-layout-${item}-tip`}
						onClick={() => onChange(item)}
						onMouseEnter={() => setShown(item)}
						onMouseLeave={hide}
						onFocus={() => setShown(item)}
						onBlur={hide}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								hide();
							}
						}}
					/>
					<span
						id={`graph-layout-${item}-tip`}
						role="tooltip"
						hidden={shown !== item}
						className={clsx(tip.bubble)}
					>
						{graphLayoutTip[item]}
					</span>
				</span>
			))}
		</fieldset>
	);
}

/** Only the Layered layout has a direction, so Force disables the switch. */
export function DirectionSwitch({
	direction,
	disabled = false,
	onChange,
}: {
	direction: GraphDirection;
	disabled?: boolean;
	onChange: (direction: GraphDirection) => void;
}) {
	return (
		<fieldset
			className={clsx(headerControlStyle.group, control.groupOff)}
			disabled={disabled}
		>
			<legend className={clsx(cards.graphProbe)}>Graph direction</legend>
			{graphDirections.map((item) => (
				<Segment
					key={item}
					id={`graph-direction-${item}`}
					label={graphDirectionLabel[item]}
					on={direction === item}
					onClick={() => onChange(item)}
				/>
			))}
		</fieldset>
	);
}
