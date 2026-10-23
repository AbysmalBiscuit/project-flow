/** Hue in degrees 0 to 360, saturation and value 0 to 1. */
export type Hsv = { h: number; s: number; v: number };

const hexPattern = /^#?([0-9a-f]{6})$/i;

/** The `#rrggbb` form of a typed hex value, or null when it is not one. */
export function hexOf(text: string): string | null {
	const digits = text.trim().match(hexPattern)?.[1];
	return digits === undefined ? null : `#${digits.toLowerCase()}`;
}

export function hexToHsv(hex: string): Hsv {
	const value = Number.parseInt(hex.slice(1), 16);
	const r = ((value >> 16) & 0xff) / 255;
	const g = ((value >> 8) & 0xff) / 255;
	const b = (value & 0xff) / 255;
	const max = Math.max(r, g, b);
	const delta = max - Math.min(r, g, b);
	let h = 0;
	if (delta !== 0) {
		if (max === r) {
			h = ((g - b) / delta) % 6;
		} else if (max === g) {
			h = (b - r) / delta + 2;
		} else {
			h = (r - g) / delta + 4;
		}
	}
	return {
		h: (h * 60 + 360) % 360,
		s: max === 0 ? 0 : delta / max,
		v: max,
	};
}

export function hsvToHex({ h, s, v }: Hsv): string {
	const channel = (n: number): string => {
		const k = (n + h / 60) % 6;
		const level = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
		return Math.round(level * 255)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${channel(5)}${channel(3)}${channel(1)}`;
}
