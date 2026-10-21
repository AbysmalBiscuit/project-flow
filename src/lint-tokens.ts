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
const colourLiteral =
	/#[0-9a-fA-F]{3,8}\b|\b(?:rgba|hsla|rgb|hsl|hwb|lab|lch|oklab|oklch|color)\(/i;
const namedColourLiteral = new RegExp(
	`(?::\\s*|\\(\\s*)(?:${namedColour})\\b`,
	"i",
);
const size = /\b\d*\.?\d+(?:px|rem)\b/;
const customProperty = /(?<![\w-])--[A-Za-z][A-Za-z0-9-]*\b/g;
const tokenDefinition = /\b(?:defineVars|defineConsts|createTheme)\s*\(/;
const styleCall =
	/\bstylex\s*\.\s*(?:create(?:Theme)?|defineVars|defineConsts)\s*\(/;
const styleFile = /(?:\.stylex\.ts|\.css)$/;
const graphFile = /(?:^|\/)graph(?:\.|-)/;

const files = new Glob("src/**/*.{ts,tsx,css}").scan({
	cwd: root,
	onlyFiles: true,
});

function styleSource(name: string): boolean {
	return (
		styleFile.test(name) ||
		name.endsWith(".tsx") ||
		name.endsWith("-styles.ts") ||
		name.endsWith("/styles.ts") ||
		name === "src/theme.ts"
	);
}

function tokenValues(name: string): boolean {
	return name === "src/tokens.stylex.ts";
}

function inGraph(name: string, lines: string[], index: number): boolean {
	if (graphFile.test(name)) {
		return true;
	}
	const line = lines[index] ?? "";
	return /\b(?:x|y|width|height)\s*:/.test(line) && /[+\-*/]/.test(line);
}

function styleRegion(lines: string[]): boolean[] {
	const region = lines.map(() => false);
	let depth = 0;
	let open = false;
	for (const [index, line] of lines.entries()) {
		if (!open && styleCall.test(line)) {
			open = true;
			depth = 0;
		}
		if (open) {
			region[index] = true;
		}
		for (const char of line) {
			if (char === "{") {
				depth += 1;
			} else if (char === "}") {
				depth -= 1;
			}
		}
		if (open && depth <= 0 && line.includes("}")) {
			open = false;
			depth = 0;
		}
	}
	return region;
}

for await (const name of files) {
	if (name === "src/lint-tokens.ts") {
		continue;
	}
	if (name === "src/tokens.stylex.ts") {
		const text = await Bun.file(`${root}/${name}`).text();
		const lines = text.split("\n");
		let depth = 0;
		let inPalette = false;
		for (const [index, line] of lines.entries()) {
			if (/^export const (?:light|dark)Values = \{/.test(line)) {
				inPalette = true;
				depth = 1;
				continue;
			}
			if (inPalette) {
				for (const char of line) {
					if (char === "{") {
						depth += 1;
					} else if (char === "}") {
						depth -= 1;
					}
				}
				if (depth <= 0) {
					inPalette = false;
				}
				continue;
			}
			if (colourLiteral.test(line) || namedColourLiteral.test(line)) {
				failures.push(`${name}:${index + 1}: colour or size literal`);
			}
			colourLiteral.lastIndex = 0;
			namedColourLiteral.lastIndex = 0;
		}
		continue;
	}
	const source = await Bun.file(`${root}/${name}`).text();
	const sourceLines = source.split("\n");
	let trackerMap = false;
	let trackerDepth = 0;
	for (const [index, line] of sourceLines.entries()) {
		if (
			name === "src/github.ts" &&
			line.includes("const githubOptionColours")
		) {
			trackerMap = true;
			trackerDepth = 0;
		}
		if (trackerMap) {
			for (const char of line) {
				if (char === "{") {
					trackerDepth += 1;
				} else if (char === "}") {
					trackerDepth -= 1;
				}
			}
			if (trackerDepth <= 0 && line.includes("}")) {
				trackerMap = false;
			}
			continue;
		}
		if (colourLiteral.test(line)) {
			failures.push(`${name}:${index + 1}: colour or size literal`);
		}
		colourLiteral.lastIndex = 0;
	}
	const text = await Bun.file(`${root}/${name}`).text();
	const lines = text.split("\n");
	for (const [index, line] of lines.entries()) {
		if (!tokenDefinition.test(line)) {
			continue;
		}
		if (
			name !== "src/tokens.stylex.ts" &&
			(line.includes("defineVars") || !name.endsWith(".stylex.ts"))
		) {
			failures.push(`${name}:${index + 1}: token definition`);
		}
	}
	if (!styleSource(name)) {
		continue;
	}
	const region = styleRegion(lines);
	for (const [index, line] of lines.entries()) {
		const styled =
			styleFile.test(name) ||
			name.endsWith("-styles.ts") ||
			name.endsWith("/styles.ts") ||
			(region[index] ?? false) ||
			line.includes("style");
		if (
			styled &&
			!tokenValues(name) &&
			!inGraph(name, lines, index) &&
			(colourLiteral.test(line) ||
				namedColourLiteral.test(line) ||
				size.test(line))
		) {
			failures.push(`${name}:${index + 1}: colour or size literal`);
		}
		colourLiteral.lastIndex = 0;
		namedColourLiteral.lastIndex = 0;
		if (!styled) {
			continue;
		}
		for (const match of line.matchAll(customProperty)) {
			const property = match[0];
			if (property.startsWith("--xy-")) {
				continue;
			}
			const key = property.slice(2);
			if (declared.has(key)) {
				failures.push(`${name}:${index + 1}: hashed token name ${property}`);
				continue;
			}
			failures.push(
				`${name}:${index + 1}: unknown custom property ${property}`,
			);
		}
	}
}

if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
