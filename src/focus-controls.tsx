import * as stylex from "@stylexjs/stylex";
import { Button } from "./button.tsx";
import type { FocusView } from "./focus.ts";
import { clearFocusLabel, overviewControlLabel } from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import { measure } from "./tokens.stylex.ts";

const styles = stylex.create({
	search: {
		width: measure.search,
	},
});

export function ClearFocusButton({ onClear }: { onClear: () => void }) {
	return <Button id="clear-focus" label={clearFocusLabel} onClick={onClear} />;
}

/**
 * The overview search field, with Clear focus beside it in focus mode.
 * The overview graph clears the focus set when it leaves the page.
 */
export function OverviewSearch({
	query,
	onQuery,
	focus,
}: {
	query: string;
	onQuery: (query: string) => void;
	focus: FocusView;
}) {
	return (
		<>
			<TextInput
				id="overview-search"
				type="search"
				icon="search"
				width={styles.search}
				aria-label={overviewControlLabel.search}
				placeholder={overviewControlLabel.search}
				value={query}
				onChange={(event) => onQuery(event.target.value)}
			/>
			{focus.focus.size === 0 ? null : (
				<ClearFocusButton onClear={focus.clear} />
			)}
		</>
	);
}
