import pluginSyntaxJsx from "@babel/plugin-syntax-jsx";
import pluginSyntaxTypescript from "@babel/plugin-syntax-typescript";
import stylexBabelPlugin from "@stylexjs/babel-plugin";
import type { BunPlugin } from "bun";

type BabelResult = {
	code: string | null;
	metadata?: { stylex?: ReadonlyArray<readonly unknown[]> };
};

type BabelApi = {
	transformAsync: (
		code: string,
		options: Record<string, unknown>,
	) => Promise<BabelResult | null>;
};

const babel = (await import("@babel/core" as string)) as BabelApi;

const rootDir = `${import.meta.dir}/..`;
const rules = new Map<string, ReadonlyArray<readonly unknown[]>>();

async function compile(code: string, filename: string): Promise<string> {
	const result = await babel.transformAsync(code, {
		babelrc: false,
		configFile: false,
		filename,
		plugins: [
			[pluginSyntaxTypescript, { isTSX: filename.endsWith("x") }],
			pluginSyntaxJsx,
			stylexBabelPlugin.withOptions({
				dev: false,
				runtimeInjection: false,
				importSources: ["@stylexjs/stylex"],
				unstable_moduleResolution: { type: "commonJS", rootDir },
			}),
		],
	});
	const metadata = result?.metadata as
		| { stylex?: ReadonlyArray<readonly unknown[]> }
		| undefined;
	if (metadata?.stylex !== undefined && metadata.stylex.length > 0) {
		rules.set(filename, metadata.stylex);
	} else {
		rules.delete(filename);
	}
	return result?.code ?? code;
}

function collectedCss(): string {
	const flat = [...rules.values()].flat();
	if (flat.length === 0) {
		return "";
	}
	return stylexBabelPlugin.processStylexRules(
		flat as Parameters<typeof stylexBabelPlugin.processStylexRules>[0],
		{ useLayers: true },
	);
}

function loaderFor(path: string): "tsx" | "ts" | "jsx" | "js" {
	if (path.endsWith(".tsx")) {
		return "tsx";
	}
	if (path.endsWith(".ts")) {
		return "ts";
	}
	if (path.endsWith(".jsx")) {
		return "jsx";
	}
	return "js";
}

let compiled: Promise<Map<string, string>> | null = null;

async function compileTree(): Promise<Map<string, string>> {
	const files = new Bun.Glob("src/**/*.{ts,tsx}").scan({
		cwd: rootDir,
		onlyFiles: true,
	});
	const output = new Map<string, string>();
	for await (const name of files) {
		const path = `${rootDir}/${name}`;
		const code = await Bun.file(path).text();
		if (!code.includes("@stylexjs/stylex")) {
			continue;
		}
		output.set(path, await compile(code, path));
	}
	return output;
}

function compiledTree(): Promise<Map<string, string>> {
	compiled ??= compileTree();
	return compiled;
}

const plugin: BunPlugin = {
	name: "project-flow-stylex",
	setup(build) {
		compiled = null;
		rules.clear();
		build.onLoad({ filter: /\.css$/ }, async (args) => {
			await compiledTree();
			const source = await Bun.file(args.path).text();
			return { contents: `${source}\n${collectedCss()}`, loader: "css" };
		});
		build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
			const output = await compiledTree();
			const next = output.get(args.path);
			if (next === undefined) {
				return undefined;
			}
			return { contents: next, loader: loaderFor(args.path) };
		});
	},
};

export default plugin;
