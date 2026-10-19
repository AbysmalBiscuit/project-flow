import { Glob } from "bun";

const root = `${import.meta.dir}/..`;
const glossary = await Bun.file(`${root}/GLOSSARY.md`).text();

type Avoided = { word: string; qualifier: string | null };

function avoidedWord(part: string): Avoided | null {
	const trimmed = part.trim();
	if (trimmed.length === 0) {
		return null;
	}
	const qualified = trimmed.match(/^(.+?)\s+\(when ([^)]+)\)$/i);
	if (qualified?.[1] === undefined || qualified[2] === undefined) {
		return { word: trimmed, qualifier: null };
	}
	return { word: qualified[1].trim(), qualifier: qualified[2] };
}

const avoided = [...glossary.matchAll(/_Avoid_: ([^\n]+)/g)].flatMap((match) =>
	(match[1] ?? "")
		.split(",")
		.map(avoidedWord)
		.filter((item) => item !== null),
);

const failures: string[] = [];
const files = new Glob("src/**/*.tsx").scan({ cwd: root, onlyFiles: true });
const attribute =
	/\b(?:aria-label|label|title|placeholder|alt)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{([^{}]+)\})/g;
const textNode = />\s*(\{([^{}]+)\}|[^<{][^<{]{0,80}?)\s*</g;
const stringLiteral = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;

function wordsOf(value: string): string[] {
	return [...value.matchAll(stringLiteral)].map(
		(match) => match[1] ?? match[2] ?? "",
	);
}

function renderedLabel(raw: string): string | null {
	const value = raw.trim();
	if (value === "" || value.startsWith("{")) {
		return null;
	}
	if (/^[a-z][a-zA-Z0-9.]*$/.test(value)) {
		return null;
	}
	return value;
}

function hits(value: string, line: string): Avoided[] {
	const folded = value.toLowerCase();
	return avoided.filter((item) => {
		if (folded !== item.word.toLowerCase()) {
			return false;
		}
		if (item.qualifier === null) {
			return true;
		}
		return line.toLowerCase().includes(item.qualifier.toLowerCase());
	});
}

function report(
	name: string,
	text: string,
	index: number,
	value: string,
): void {
	const line = text.slice(0, index).split("\n").length;
	const source = text.split("\n")[line - 1] ?? "";
	for (const hit of hits(value, source)) {
		failures.push(`${name}:${line}: avoided word ${hit.word}`);
	}
}

for await (const name of files) {
	const text = await Bun.file(`${root}/${name}`).text();
	for (const match of text.matchAll(attribute)) {
		const literal = match[1] ?? match[2];
		const expression = match[3];
		if (literal !== undefined) {
			report(name, text, match.index, literal);
			continue;
		}
		if (expression === undefined) {
			continue;
		}
		for (const word of wordsOf(expression)) {
			report(name, text, match.index, word);
		}
	}
	for (const match of text.matchAll(textNode)) {
		const expression = match[2];
		if (expression !== undefined) {
			for (const word of wordsOf(expression)) {
				report(name, text, match.index, word);
			}
			continue;
		}
		const label = renderedLabel(match[1] ?? "");
		if (label !== null) {
			report(name, text, match.index, label);
		}
	}
}

if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
