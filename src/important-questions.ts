function section(body: string, heading: string): string {
	const lines = body.split("\n");
	const start = lines.findIndex((line) => line.trim() === heading);
	if (start === -1) {
		return "";
	}
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => /^#{1,3}\s/.test(line));
	return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * The numbers of the Important Questions in a workcell PR body that have no
 * entry with the same number in its Answers section.
 */
export function openImportantQuestions(body: string): number[] {
	const asked = [
		...section(body, "### Important Questions").matchAll(
			/<summary>(?:\s|<[^>]+>)*(\d+)\./g,
		),
	].map((match) => Number(match[1]));
	const answered = new Set(
		[...section(body, "### Answers").matchAll(/^(\d+)\.\s/gm)].map((match) =>
			Number(match[1]),
		),
	);
	return asked.filter((number) => !answered.has(number));
}
