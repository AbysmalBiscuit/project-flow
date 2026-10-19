import { Glob } from "bun";

const root = `${import.meta.dir}/..`;
const glossary = await Bun.file(`${root}/GLOSSARY.md`).text();
const avoided = [...glossary.matchAll(/_Avoid_: ([^\n]+)/g)].flatMap((match) =>
	(match[1] ?? "")
		.split(",")
		.map((word) => word.trim())
		.filter((word) => word.length > 0),
);

const label =
	/(?:label|title|text|children):\s*"([^"]+)"|>\s*([A-Z][^<{]{1,40})\s*</g;
const failures: string[] = [];
const files = new Glob("src/**/*.tsx").scan({ cwd: root, onlyFiles: true });

for await (const name of files) {
	const text = await Bun.file(`${root}/${name}`).text();
	for (const match of text.matchAll(label)) {
		const value = match[1] ?? match[2] ?? "";
		const hit = avoided.find(
			(word) => value.toLowerCase() === word.toLowerCase(),
		);
		if (hit !== undefined) {
			const line = text.slice(0, match.index).split("\n").length;
			failures.push(`${name}:${line}: avoided word ${hit}`);
		}
	}
}

if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
