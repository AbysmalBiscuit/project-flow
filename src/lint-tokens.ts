import { Glob } from "bun";

const colour = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(/;
const size = /\b\d*\.?\d+(?:px|rem)\b/;

const files = new Glob("**/*.css").scan({
	cwd: import.meta.dir,
	onlyFiles: true,
});
const failures: string[] = [];

for await (const name of files) {
	if (name === "tokens.css") {
		continue;
	}
	const text = await Bun.file(`${import.meta.dir}/${name}`).text();
	const lines = text.split("\n");
	for (const [index, line] of lines.entries()) {
		const code = line
			.replace(/\/\*.*?\*\//g, "")
			.replace(/var\(--[a-z0-9-]+\)/gi, "");
		if (colour.test(code) || size.test(code)) {
			failures.push(`src/${name}:${index + 1}: colour or size literal`);
		}
	}
}

if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
