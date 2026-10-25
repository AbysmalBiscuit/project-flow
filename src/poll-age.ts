import { useEffect, useState } from "react";

import { overviewControlLabel } from "./terms.ts";

const minuteSeconds = 60;
const hourSeconds = 60 * minuteSeconds;
const daySeconds = 24 * hourSeconds;

/** The span from one time to a later one, in its largest whole unit. */
export function spanLabel(fromMs: number, toMs: number): string {
	const seconds = Math.max(0, Math.floor((toMs - fromMs) / 1000));
	return seconds < minuteSeconds
		? `${seconds} s`
		: seconds < hourSeconds
			? `${Math.floor(seconds / minuteSeconds)} min`
			: seconds < daySeconds
				? `${Math.floor(seconds / hourSeconds)} h`
				: `${Math.floor(seconds / daySeconds)} d`;
}

export function updatedAgo(fetchedAtMs: number, now: number): string | null {
	if (fetchedAtMs <= 0) {
		return null;
	}
	return `${overviewControlLabel.updated} ${spanLabel(fetchedAtMs, now)} ago`;
}

export function usePollAge(fetchedAtMs: number): string | null {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 200);
		return () => clearInterval(timer);
	}, []);
	return updatedAgo(fetchedAtMs, now);
}
