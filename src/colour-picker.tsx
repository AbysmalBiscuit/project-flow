import * as stylex from "@stylexjs/stylex";
import {
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";

import { hexOf, hexToHsv, type Hsv, hsvToHex } from "./colour-space.ts";
import { control } from "./control-styles.ts";
import { settingsCopy } from "./terms.ts";
import { TextInput } from "./text-input.tsx";
import {
	colours,
	font,
	measure,
	picker,
	radius,
	space,
	stack,
	type,
} from "./tokens.stylex.ts";
import { shell } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	anchor: {
		position: "relative",
		display: "inline-flex",
	},
	swatchButton: {
		display: "inline-flex",
		gap: space.sm,
		alignItems: "center",
		paddingLeft: space.xs,
		fontFamily: font.mono,
	},
	swatch: {
		width: measure.swatchButton,
		height: measure.swatchButton,
		flexShrink: 0,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.lineStrong,
		borderRadius: radius.sm,
	},
	popover: {
		position: "absolute",
		zIndex: stack.popover,
		top: `calc(100% + ${space.xs})`,
		right: 0,
		display: "flex",
		flexDirection: "column",
		gap: space.md,
		boxSizing: "border-box",
		width: measure.picker,
		padding: space.md,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.raised,
		boxShadow: `0 0 ${space.md} ${colours.shadow}`,
		color: colours.ink,
	},
	area: {
		position: "relative",
		width: "100%",
		aspectRatio: "4 / 3",
		borderRadius: radius.sm,
		backgroundImage: `linear-gradient(to top, ${picker.black}, transparent), linear-gradient(to right, ${picker.white}, transparent)`,
		cursor: "crosshair",
		touchAction: "none",
		outline: {
			default: "none",
			":focus-visible": `${measure.focus} solid ${colours.focus}`,
		},
		outlineOffset: measure.focus,
	},
	hue: {
		position: "relative",
		height: measure.pickerBar,
		borderRadius: radius.pill,
		backgroundImage: picker.hue,
		cursor: "pointer",
		touchAction: "none",
		outline: {
			default: "none",
			":focus-visible": `${measure.focus} solid ${colours.focus}`,
		},
		outlineOffset: measure.focus,
	},
	thumb: {
		position: "absolute",
		width: measure.pickerThumb,
		height: measure.pickerThumb,
		boxSizing: "border-box",
		borderWidth: measure.focus,
		borderStyle: "solid",
		borderColor: picker.white,
		borderRadius: radius.pill,
		boxShadow: `0 0 0 ${measure.hairline} ${picker.black}`,
		transform: "translate(-50%, -50%)",
		pointerEvents: "none",
	},
	hueThumb: {
		top: "50%",
	},
	fields: {
		display: "flex",
		gap: space.sm,
		alignItems: "center",
	},
	preview: {
		width: measure.control,
		height: measure.control,
		flexShrink: 0,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.lineStrong,
		borderRadius: radius.sm,
	},
	hexLabel: {
		display: "flex",
		flexDirection: "column",
		flexGrow: 1,
		gap: space.twoXs,
		minWidth: 0,
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	hexInput: {
		width: "100%",
	},
});

const dynamic = stylex.create({
	fill: (colour: string) => ({ backgroundColor: colour }),
	at: (left: string, top: string) => ({ left, top }),
	left: (left: string) => ({ left }),
});

const keyStep = 0.02;

function clamp(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function pointerShare(event: PointerEvent<HTMLDivElement>) {
	const box = event.currentTarget.getBoundingClientRect();
	return {
		x: clamp((event.clientX - box.left) / box.width),
		y: clamp((event.clientY - box.top) / box.height),
	};
}

function percent(share: number): string {
	return `${share * 100}%`;
}

/** Arrow keys move a share by one step, and Shift moves it five steps. */
function keyMove(event: KeyboardEvent): { x: number; y: number } | null {
	const step = event.shiftKey ? keyStep * 5 : keyStep;
	const moves: Record<string, { x: number; y: number }> = {
		ArrowLeft: { x: -step, y: 0 },
		ArrowRight: { x: step, y: 0 },
		ArrowUp: { x: 0, y: -step },
		ArrowDown: { x: 0, y: step },
	};
	return moves[event.key] ?? null;
}

/**
 * A swatch button that opens a colour picker popover: a saturation and value
 * area, a hue bar, a hex field and a preview swatch.
 */
export function ColourPicker({
	id,
	label,
	value,
	onChange,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (hex: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [hsv, setHsv] = useState(() => hexToHsv(value));
	const [text, setText] = useState(value);
	const anchor = useRef<HTMLDivElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	const popoverId = `${id}-picker`;

	useEffect(() => {
		setHsv((current) =>
			hsvToHex(current) === value ? current : hexToHsv(value),
		);
		setText(value);
	}, [value]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const onDown = (event: globalThis.PointerEvent) => {
			if (
				event.target instanceof Node &&
				anchor.current?.contains(event.target) !== true
			) {
				setOpen(false);
			}
		};
		const onKey = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			event.preventDefault();
			setOpen(false);
			button.current?.focus();
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	function pick(next: Hsv): void {
		setHsv(next);
		const hex = hsvToHex(next);
		setText(hex);
		onChange(hex);
	}

	function dragArea(event: PointerEvent<HTMLDivElement>): void {
		const { x, y } = pointerShare(event);
		pick({ ...hsv, s: x, v: 1 - y });
	}

	function dragHue(event: PointerEvent<HTMLDivElement>): void {
		pick({ ...hsv, h: pointerShare(event).x * 360 });
	}

	const hueColour = hsvToHex({ h: hsv.h, s: 1, v: 1 });
	const typed = hexOf(text);

	return (
		<div ref={anchor} className={clsx(styles.anchor)}>
			<button
				ref={button}
				id={id}
				type="button"
				className={clsx(
					control.box,
					control.off,
					styles.swatchButton,
					shell.buttonFocus,
				)}
				aria-label={`${label} ${settingsCopy.colour}`}
				aria-expanded={open}
				aria-controls={popoverId}
				onClick={() => setOpen((shown) => !shown)}
			>
				<span
					{...stylex.props(styles.swatch, dynamic.fill(value))}
					aria-hidden="true"
				/>
				{value}
			</button>
			{open ? (
				<div
					id={popoverId}
					role="dialog"
					aria-label={`${label} ${settingsCopy.colour}`}
					className={clsx(styles.popover)}
				>
					<div
						id={`${id}-area`}
						role="slider"
						tabIndex={0}
						aria-label={settingsCopy.saturation}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(hsv.s * 100)}
						aria-valuetext={`${Math.round(hsv.s * 100)}%, ${settingsCopy.brightness} ${Math.round(hsv.v * 100)}%`}
						{...stylex.props(styles.area, dynamic.fill(hueColour))}
						onPointerDown={(event) => {
							event.currentTarget.setPointerCapture(event.pointerId);
							dragArea(event);
						}}
						onPointerMove={(event) => {
							if (event.currentTarget.hasPointerCapture(event.pointerId)) {
								dragArea(event);
							}
						}}
						onKeyDown={(event) => {
							const move = keyMove(event);
							if (move === null) {
								return;
							}
							event.preventDefault();
							pick({
								...hsv,
								s: clamp(hsv.s + move.x),
								v: clamp(hsv.v - move.y),
							});
						}}
					>
						<span
							{...stylex.props(
								styles.thumb,
								dynamic.at(percent(hsv.s), percent(1 - hsv.v)),
								dynamic.fill(value),
							)}
						/>
					</div>
					<div
						id={`${id}-hue`}
						role="slider"
						tabIndex={0}
						aria-label={settingsCopy.hue}
						aria-valuemin={0}
						aria-valuemax={360}
						aria-valuenow={Math.round(hsv.h)}
						className={clsx(styles.hue)}
						onPointerDown={(event) => {
							event.currentTarget.setPointerCapture(event.pointerId);
							dragHue(event);
						}}
						onPointerMove={(event) => {
							if (event.currentTarget.hasPointerCapture(event.pointerId)) {
								dragHue(event);
							}
						}}
						onKeyDown={(event) => {
							const move = keyMove(event);
							if (move === null) {
								return;
							}
							event.preventDefault();
							pick({
								...hsv,
								h: (hsv.h + (move.x - move.y) * 360 + 360) % 360,
							});
						}}
					>
						<span
							{...stylex.props(
								styles.thumb,
								styles.hueThumb,
								dynamic.left(percent(hsv.h / 360)),
								dynamic.fill(hueColour),
							)}
						/>
					</div>
					<div className={clsx(styles.fields)}>
						<span
							id={`${id}-preview`}
							{...stylex.props(styles.preview, dynamic.fill(value))}
							aria-hidden="true"
						/>
						<label htmlFor={`${id}-hex`} className={clsx(styles.hexLabel)}>
							{settingsCopy.hex}
							<TextInput
								id={`${id}-hex`}
								width={styles.hexInput}
								value={text}
								spellCheck={false}
								invalid={typed === null}
								onChange={(event) => {
									setText(event.target.value);
									const hex = hexOf(event.target.value);
									if (hex !== null) {
										setHsv(hexToHsv(hex));
										onChange(hex);
									}
								}}
								onBlur={() => setText(value)}
							/>
						</label>
					</div>
				</div>
			) : null}
		</div>
	);
}
