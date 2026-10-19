import { Glob } from "bun";

const namedColour =
	"aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen";
const colourFunction = "rgba|hsla|rgb|hsl|hwb|lab|lch|oklab|oklch|color";
const hex = "#[0-9a-fA-F]{3,8}\\b";
const colour = new RegExp(
	`${hex}|\\b(?:${colourFunction})\\(|\\b(?:${namedColour})\\b`,
	"gi",
);
const colorMix = /\bcolor-mix\([^)]*\)/gi;
const size = /\b\d*\.?\d+(?:px|rem)\b/i;

function hasLiteral(value: string): boolean {
	colour.lastIndex = 0;
	return colour.test(value);
}

function hasColour(code: string): boolean {
	const mixes = code.match(colorMix) ?? [];
	const outside = code.replace(colorMix, " ");
	if (hasLiteral(outside)) {
		return true;
	}
	return mixes.some((mix) => hasLiteral(mix));
}

const root = `${import.meta.dir}/..`;
const files = new Glob("**/*.css").scan({
	cwd: root,
	onlyFiles: true,
	dot: true,
});
const failures: string[] = [];

for await (const name of files) {
	if (name.startsWith("node_modules/") || name === "src/tokens.css") {
		continue;
	}
	const text = await Bun.file(`${root}/${name}`).text();
	const stripped = text.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
		comment.replace(/[^\n]/g, " "),
	);
	const lines = stripped.split("\n");
	let depth = 0;
	for (const [index, line] of lines.entries()) {
		const code = line
			.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, " ")
			.replace(/var\(--[a-z0-9-]+\)/gi, "");
		const brace = code.indexOf("{");
		const inRule = depth > 0 || brace !== -1;
		const decl = brace === -1 ? code : code.slice(brace + 1);
		const value = decl.replace(/^[^{};]*:/, "");
		if (size.test(code) || (inRule && hasColour(value))) {
			failures.push(`${name}:${index + 1}: colour or size literal`);
		}
		depth +=
			(code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;
		if (depth < 0) {
			depth = 0;
		}
	}
}

if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}
