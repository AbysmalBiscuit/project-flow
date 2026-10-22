import type { FocusView } from "./focus.ts";
import { SearchGlyph } from "./shell.tsx";
import { clearFocusLabel, overviewControlLabel } from "./terms.ts";
import { clsx } from "./ui.ts";
import { headerControlStyle, shell } from "./ui-styles.ts";

export function ClearFocusButton({ onClear }: { onClear: () => void }) {
	return (
		<button
			type="button"
			id="clear-focus"
			className={clsx(headerControlStyle.control, shell.buttonFocus)}
			onClick={onClear}
		>
			{clearFocusLabel}
		</button>
	);
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
			<label
				className={clsx(headerControlStyle.search)}
				htmlFor="overview-search"
			>
				<SearchGlyph />
				<input
					id="overview-search"
					className={clsx(headerControlStyle.field)}
					type="search"
					aria-label={overviewControlLabel.search}
					placeholder={overviewControlLabel.search}
					value={query}
					onChange={(event) => onQuery(event.target.value)}
				/>
			</label>
			{focus.focus.size === 0 ? null : (
				<ClearFocusButton onClear={focus.clear} />
			)}
		</>
	);
}
