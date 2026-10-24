import { useState } from "react";

import { Button } from "./button.tsx";
import { ColourPicker } from "./colour-picker.tsx";
import type { StateColours } from "./configuration.ts";
import { ConfirmDialog } from "./confirm-dialog.tsx";
import { Row } from "./settings-parts.tsx";
import { settings as fields } from "./settings-styles.ts";
import { colouredStates } from "./state-colours.ts";
import { settingsCopy, settingsSection, stateLabel } from "./terms.ts";
import { clsx } from "./ui.ts";

export function StateColoursSection({
	colours,
	onChange,
	onReset,
}: {
	colours: StateColours;
	onChange: (next: StateColours) => void;
	onReset: () => void;
}) {
	const [asking, setAsking] = useState(false);
	return (
		<section id="colours" className={clsx(fields.card)}>
			<div className={clsx(fields.cardHead)}>
				<h2 className={clsx(fields.cardTitle)}>{settingsSection.colours}</h2>
				<Button
					id="reset-colours"
					label={settingsCopy.reset}
					onClick={() => setAsking(true)}
				/>
			</div>
			<p className={clsx(fields.hint)}>{settingsCopy.coloursLead}</p>
			{colouredStates.map((state) => (
				<Row key={state} title={stateLabel[state]}>
					<ColourPicker
						id={`colour-${state}`}
						label={stateLabel[state]}
						value={colours[state]}
						onChange={(hex) => onChange({ ...colours, [state]: hex })}
					/>
				</Row>
			))}
			<ConfirmDialog
				id="reset-colours-dialog"
				open={asking}
				title={settingsCopy.resetTitle}
				body={settingsCopy.resetBody}
				confirmLabel={settingsCopy.resetConfirm}
				onCancel={() => setAsking(false)}
				onConfirm={() => {
					setAsking(false);
					onReset();
				}}
			/>
		</section>
	);
}
