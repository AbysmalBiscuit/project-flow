import type { ComponentPropsWithoutRef } from "react";

import { control } from "./control-styles.ts";
import { shell } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

type SelectProps<Value extends string | number> = Omit<
	ComponentPropsWithoutRef<"select">,
	"className" | "style" | "value" | "onChange" | "children"
> & {
	/** `undefined` shows the placeholder. */
	value: Value | undefined;
	options: readonly { value: Value; label: string }[];
	onChange: (next: Value) => void;
	placeholder?: string;
};

/** A native select at the shared control height. */
export function Select<Value extends string | number>({
	value,
	options,
	onChange,
	placeholder,
	...native
}: SelectProps<Value>) {
	return (
		<select
			{...native}
			className={clsx(control.box, control.off, shell.buttonFocus)}
			value={value === undefined ? "" : String(value)}
			onChange={(event) => {
				const picked = options.find(
					(option) => String(option.value) === event.target.value,
				);
				if (picked !== undefined) {
					onChange(picked.value);
				}
			}}
		>
			{placeholder === undefined ? null : (
				<option value="">{placeholder}</option>
			)}
			{options.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	);
}
