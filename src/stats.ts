/** The nearest-rank percentile `share` of the values, or null for no values. */
export function percentile(
	values: readonly number[],
	share: number,
): number | null {
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)] ?? null;
}
