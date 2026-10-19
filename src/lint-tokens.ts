import { Glob } from "bun";

const colour = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl|hwb|lab|lch|oklab|color)\(/i;
const size = /\b\d*\.?\d+(?:px|rem)\b/;

const root = `${import.meta.dir}/..`;
const files = new Glob("**/*.css").scan({
	cwd: root,
	onlyFiles: true,
	dot: true,
});
const failures: string[] = [];

for await (const name of files) {
	if (
		name.startsWith("node_modules/") ||
		name.endsWith("/tokens.css") ||
		name === "tokens.css"
	) {
		continue;
	}
	const text = await Bun.file(`${root}/${name}`).text();
	const stripped = text.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
		comment.replace(/[^\n]/g, " "),
	);
	const lines = stripped.split("\n");
	for (const [index, line] of lines.entries()) {
		const code = line.replace(/var\(--[a-z0-9-]+\)/gi, "");
		if (colour.test(code) || size.test(code)) {
			failures.push(`${name}:${index + 1}: colour or size literal`);
		}
	}
}

if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
