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

const terms = new Set(
	[...glossary.matchAll(/^\*\*([^*]+)\*\*:/gm)].map((match) =>
		(match[1] ?? "").trim(),
	),
);

const failures: string[] = [];
const files = new Glob("src/**/*.{ts,tsx}").scan({
	cwd: root,
	onlyFiles: true,
});
const attribute =
	/\b(?:aria-label|label|title|placeholder|alt)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{([^{}]+)\})/g;
const textNode = /(?<=>)\s*(\{([^{}]+)\}|[^<{][^<{]{0,80}?)\s*</g;
const stringLiteral = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
const templateLiteral = /`([^`\\]*(?:\\.[^`\\]*)*)`/g;
const constLabel =
	/\b(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`)/g;
const objectLabel =
	/^\t([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'),?$/;

function wordsOf(value: string): string[] {
	const words = [...value.matchAll(stringLiteral)].map(
		(match) => match[1] ?? match[2] ?? "",
	);
	for (const match of value.matchAll(templateLiteral)) {
		words.push(match[1] ?? "");
	}
	return words;
}

function heldLabels(text: string): Map<string, string> {
	const held = new Map<string, string>();
	for (const match of text.matchAll(constLabel)) {
		const name = match[1];
		const value = match[2] ?? match[3] ?? match[4];
		if (name === undefined || value === undefined || value.trim() === "") {
			continue;
		}
		held.set(name, value);
	}
	for (const line of text.split("\n")) {
		const field = line.match(objectLabel);
		const key = field?.[1];
		const value = field?.[2] ?? field?.[3];
		if (key === undefined || value === undefined || value.trim() === "") {
			continue;
		}
		held.set(key, value);
	}
	return held;
}

async function importedLabels(text: string): Promise<Map<string, string>> {
	const held = new Map<string, string>();
	const imported =
		/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
	for (const match of text.matchAll(imported)) {
		const names = match[1];
		const specifier = match[2];
		if (names === undefined || specifier === undefined) {
			continue;
		}
		if (!specifier.startsWith(".")) {
			continue;
		}
		const path = `${import.meta.dir}/${specifier.replace(/^\.\//, "")}`;
		const file = Bun.file(path.endsWith(".ts") ? path : `${path}.ts`);
		if (!(await file.exists())) {
			continue;
		}
		const source = await file.text();
		const local = heldLabels(source);
		for (const part of names.split(",")) {
			const alias = part.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/);
			const name = alias?.[1];
			if (name === undefined) {
				continue;
			}
			for (const [key, value] of local) {
				held.set(`${name}.${key}`, value);
				if (!held.has(key)) {
					held.set(key, value);
				}
			}
		}
	}
	return held;
}

function labelWords(expression: string, held: Map<string, string>): string[] {
	const words = wordsOf(expression);
	for (const token of expression.matchAll(/\b[A-Za-z_][A-Za-z0-9_.]*\b/g)) {
		const key = token[0];
		const value = held.get(key) ?? held.get(key.split(".").at(-1) ?? key);
		if (value !== undefined) {
			words.push(value);
		}
	}
	return words;
}

function renderedLabel(raw: string): string | null {
	const value = raw.trim();
	if (value === "" || value.startsWith("{")) {
		return null;
	}
	if (/^[a-z][a-zA-Z0-9.]*$/.test(value)) {
		return null;
	}
	if (!/^[\p{L}\p{N}][\p{L}\p{N}\s'.,:/&+-]*$/u.test(value)) {
		return null;
	}
	return value;
}

function containsWord(value: string, word: string): boolean {
	const pattern = new RegExp(
		`(?<![\\p{L}\\p{N}_])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`,
		"iu",
	);
	return pattern.test(value);
}

function hits(value: string, line: string): Avoided[] {
	if (terms.has(value)) {
		return [];
	}
	return avoided.filter((item) => {
		if (!containsWord(value, item.word)) {
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

function rendersUi(name: string, text: string): boolean {
	return (
		name.endsWith(".tsx") ||
		text.includes("createElement") ||
		text.includes("document.createElement") ||
		text.includes("textContent") ||
		text.includes("innerText")
	);
}

const renderedUse =
	/(?:textContent|innerText)\s*=\s*([^;\n]+)|(?<=>)\s*\{([^{}]+)\}/g;

for await (const name of files) {
	const text = await Bun.file(`${root}/${name}`).text();
	if (!rendersUi(name, text)) {
		continue;
	}
	const held = heldLabels(text);
	for (const [key, value] of await importedLabels(text)) {
		if (!held.has(key)) {
			held.set(key, value);
		}
	}
	for (const match of text.matchAll(renderedUse)) {
		const expression = match[1] ?? match[2];
		if (expression === undefined) {
			continue;
		}
		for (const word of labelWords(expression, held)) {
			report(name, text, match.index, word);
		}
	}
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
		for (const word of labelWords(expression, held)) {
			report(name, text, match.index, word);
		}
	}
	for (const match of text.matchAll(textNode)) {
		const expression = match[2];
		if (expression !== undefined) {
			for (const word of labelWords(expression, held)) {
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
