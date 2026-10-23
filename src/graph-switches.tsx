import { graphDirectionLabel, graphLayoutLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { cards, headerControlStyle } from "./ui-styles.ts";
import {
	type GraphDirection,
	type GraphLayoutKind,
	graphDirections,
	graphLayouts,
} from "./view-settings.ts";

export function LayoutSwitch({
	layout,
	onChange,
}: {
	layout: GraphLayoutKind;
	onChange: (layout: GraphLayoutKind) => void;
}) {
	return (
		<fieldset className={clsx(headerControlStyle.group)}>
			<legend className={clsx(cards.graphProbe)}>Graph layout</legend>
			{graphLayouts.map((item) => (
				<button
					key={item}
					type="button"
					id={`graph-layout-${item}`}
					className={clsx(
						headerControlStyle.segment,
						layout === item && headerControlStyle.segmentOn,
					)}
					aria-pressed={layout === item}
					onClick={() => onChange(item)}
				>
					{graphLayoutLabel[item]}
				</button>
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
			className={clsx(
				headerControlStyle.group,
				disabled && headerControlStyle.groupOff,
			)}
			disabled={disabled}
		>
			<legend className={clsx(cards.graphProbe)}>Graph direction</legend>
			{graphDirections.map((item) => (
				<button
					key={item}
					type="button"
					id={`graph-direction-${item}`}
					className={clsx(
						headerControlStyle.segment,
						direction === item && headerControlStyle.segmentOn,
					)}
					aria-pressed={direction === item}
					onClick={() => onChange(item)}
				>
					{graphDirectionLabel[item]}
				</button>
			))}
		</fieldset>
	);
}
