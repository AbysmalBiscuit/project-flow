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

const clockShift = "__projectFlowProofClockShiftMs";

function hostNow(): number {
	const shift = (globalThis as { [clockShift]?: number })[clockShift];
	return Date.now() + (typeof shift === "number" ? shift : 0);
}

export function usePollAge(fetchedAtMs: number): string | null {
	const [now, setNow] = useState(hostNow);
	useEffect(() => {
		const timer = setInterval(() => setNow(hostNow()), 1000);
		const onShift = () => setNow(hostNow());
		addEventListener("project-flow-proof-clock", onShift);
		return () => {
			clearInterval(timer);
			removeEventListener("project-flow-proof-clock", onShift);
		};
	}, []);
	return polledAgo(fetchedAtMs, now);
}
