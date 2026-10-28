import type { ComponentPropsWithoutRef } from "react";

import { control } from "./control-styles.ts";
import { headerControlStyle } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

type SegmentProps = Omit<
	ComponentPropsWithoutRef<"button">,
	| "children"
	| "className"
	| "style"
	| "type"
	| "role"
	| "aria-pressed"
	| "aria-selected"
> & {
	label: string;
	/** The chosen segment. A tab reports it as selected, a toggle as pressed. */
	on?: boolean;
	role?: "tab";
};

/**
 * One choice inside a `headerControlStyle.group`. The group has the shared
 * control height, and the segment fills it.
 */
export function Segment({ label, on, role, ...native }: SegmentProps) {
	const className = clsx(
		headerControlStyle.segment,
		control.clear,
		native.disabled === true ? control.off : control.offInGroup,
		control.focus,
		on === true && control.on,
	);
	if (role === "tab") {
		return (
			<button
				{...native}
				type="button"
				role="tab"
				aria-selected={on}
				className={className}
			>
				{label}
			</button>
		);
	}
	return (
		<button {...native} type="button" aria-pressed={on} className={className}>
			{label}
		</button>
	);
}
