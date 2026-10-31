/**
 * Prints each backend name in the code that the browser runs. The output has
 * one section for the modules of the page bundle and one for the bundle text.
 *
 * Usage: bun proof/client-names.ts
 */
import { Glob } from "bun";

import stylex from "../src/stylex-plugin.ts";

const backendName = /github|gitlab|forgejo|linear/i;
const allowedLine = /linear-gradient|animationTimingFunction/;
const root = new URL("..", import.meta.url).pathname;

const out = `${process.env.TMPDIR ?? "/tmp"}/project-flow-client-names`;
const built = await Bun.build({
	entrypoints: [`${root}src/page.tsx`],
	outdir: out,
	target: "browser",
	plugins: [stylex],
	define: { "process.env.NODE_ENV": '"production"' },
});
if (!built.success) {
	throw new Error(built.logs.join("\n"));
}

const bundles = [...new Glob("*.js").scanSync(out)];
let module = "";
let found = 0;
for (const bundle of bundles) {
	const text = await Bun.file(`${out}/${bundle}`).text();
	const modules = new Set<string>();
	for (const [index, line] of text.split("\n").entries()) {
		const heading = line.match(/^\/\/ ((?:src|node_modules)\/\S+)$/);
		if (heading?.[1] !== undefined) {
			module = heading[1];
			modules.add(module);
		}
		if (
			module.startsWith("src/") &&
			backendName.test(line) &&
			!allowedLine.test(line)
		) {
			found += 1;
			console.log(`${module}: ${index + 1}: ${line.trim().slice(0, 120)}`);
		}
	}
	const sources = [...modules].filter((name) => name.startsWith("src/"));
	console.log(`${bundle}: ${sources.length} source modules`);
	for (const source of sources) {
		const code = await Bun.file(`${root}${source}`).text();
		for (const [index, line] of code.split("\n").entries()) {
			if (backendName.test(line) && !allowedLine.test(line)) {
				found += 1;
				console.log(`source ${source}:${index + 1}: ${line.trim()}`);
			}
		}
	}
}
console.log(`${found} backend names`);
process.exit(found === 0 ? 0 : 1);
