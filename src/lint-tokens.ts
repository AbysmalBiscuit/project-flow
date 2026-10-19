import { Glob } from "bun";

const root = `${import.meta.dir}/..`;
const tokenFile = await Bun.file(`${import.meta.dir}/tokens.stylex.ts`).text();
const declared = new Set<string>();
const failures: string[] = [];
let group = new Set<string>();
let inVars = false;

for (const [index, line] of tokenFile.split("\n").entries()) {
	if (line.startsWith("export const ")) {
		group = new Set<string>();
		inVars = line.includes("defineVars");
		continue;
	}
	const name = line.match(/^\t([A-Za-z][A-Za-z0-9]*):/)?.[1];
	if (name === undefined || name === "default") {
		continue;
	}
	if (inVars && group.has(name)) {
		failures.push(
			`src/tokens.stylex.ts:${index + 1}: token redefinition ${name}`,
		);
	}
	if (inVars) {
		group.add(name);
	}
	declared.add(name);
}

const namedColour =
	"aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen";
const colour = new RegExp(
	`#[0-9a-fA-F]{3,8}\\b|\\b(?:rgba|hsla|rgb|hsl|hwb|lab|lch|oklab|oklch|color)\\(|\\b(?:${namedColour})\\b`,
	"i",
);
const size = /\b\d*\.?\d+(?:px|rem)\b/;
const customProperty = /(?<![\w-])--[A-Za-z][A-Za-z0-9-]*\b/g;
const styleSource = /(?:\.stylex\.ts|\.css)$/;

const files = new Glob("src/**/*.{ts,tsx,css}").scan({
	cwd: root,
	onlyFiles: true,
});

function isStyleSource(name: string): boolean {
	return (
		styleSource.test(name) ||
		name === "src/ui-styles.ts" ||
		name === "src/theme.ts"
	);
}

function tokenSource(name: string): boolean {
	return name === "src/theme.stylex.ts";
}

function rootFallback(name: string, lines: string[], index: number): boolean {
	if (name !== "src/global.css") {
		return false;
	}
	for (let cursor = index; cursor >= 0; cursor -= 1) {
		const line = lines[cursor] ?? "";
		if (!line.includes("{")) {
			continue;
		}
		return line.trim().startsWith(":root");
	}
	return false;
}

for await (const name of files) {
	if (name === "src/tokens.stylex.ts" || name === "src/lint-tokens.ts") {
		continue;
	}
	if (!isStyleSource(name) && !name.endsWith(".tsx")) {
		continue;
	}
	const lines = (await Bun.file(`${root}/${name}`).text()).split("\n");
	for (const [index, line] of lines.entries()) {
		const styleLine = isStyleSource(name) || line.includes("style");
		if (
			styleLine &&
			!tokenSource(name) &&
			!rootFallback(name, lines, index) &&
			(colour.test(line) || size.test(line))
		) {
			failures.push(`${name}:${index + 1}: colour or size literal`);
		}
		colour.lastIndex = 0;
		if (!styleLine) {
			continue;
		}
		for (const match of line.matchAll(customProperty)) {
			const property = match[0];
			if (!declared.has(property.slice(2))) {
				failures.push(
					`${name}:${index + 1}: unknown custom property ${property}`,
				);
			}
		}
	}
}

if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
