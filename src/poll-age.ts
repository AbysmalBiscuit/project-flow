import { useEffect, useState } from "react";

const minuteSeconds = 60;
const hourSeconds = 60 * minuteSeconds;
const daySeconds = 24 * hourSeconds;
const polled = "polled";

export function polledAgo(fetchedAtMs: number, now: number): string | null {
	if (fetchedAtMs <= 0) {
		return null;
	}
	const seconds = Math.max(0, Math.floor((now - fetchedAtMs) / 1000));
	const age =
		seconds < minuteSeconds
			? `${seconds} s`
			: seconds < hourSeconds
				? `${Math.floor(seconds / minuteSeconds)} min`
				: seconds < daySeconds
					? `${Math.floor(seconds / hourSeconds)} h`
					: `${Math.floor(seconds / daySeconds)} d`;
	return `${polled} ${age} ago`;
}

export function usePollAge(fetchedAtMs: number): string | null {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 200);
		return () => clearInterval(timer);
	}, []);
	return polledAgo(fetchedAtMs, now);
}
