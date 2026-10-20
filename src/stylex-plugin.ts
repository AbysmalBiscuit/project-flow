import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { PluginItem } from "@babel/core";
import babel from "@babel/core";
import parser from "@babel/parser";
import stylexBabelPlugin from "@stylexjs/babel-plugin";
import type { BunPlugin } from "bun";

const loadedPlugin = (name: string): PluginItem => {
	const path = require.resolve(name);
	const loaded = require(path) as { default?: PluginItem };
	return loaded.default ?? (loaded as PluginItem);
};

const rootDir = realpathSync(resolve(import.meta.dir, ".."));
const rules = new Map<string, ReadonlyArray<readonly unknown[]>>();

async function compile(code: string, filename: string): Promise<string> {
	const result = await babel.transformAsync(code, {
		babelrc: false,
		configFile: false,
		filename,
		plugins: [
			[
				loadedPlugin("@babel/plugin-syntax-typescript"),
				{ isTSX: filename.endsWith("x") },
			],
			loadedPlugin("@babel/plugin-syntax-jsx"),
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
	if (filename.endsWith("/tokens.stylex.ts")) {
		themeMeta = themeFromCompile(code, result?.code ?? "");
	}
	return result?.code ?? code;
}

export type PageThemeMeta = {
	readonly light: string;
	readonly dark: string;
	readonly canvas: { readonly light: string; readonly dark: string };
	readonly ink: { readonly light: string; readonly dark: string };
};

let themeMeta: PageThemeMeta = {
	light: "",
	dark: "",
	canvas: { light: "", dark: "" },
	ink: { light: "", dark: "" },
};

export function pageThemeMeta(): PageThemeMeta {
	return themeMeta;
}

function objectExport(source: string, name: string): Map<string, string> {
	const parsed = parser.parse(source, {
		sourceType: "module",
		plugins: ["typescript"],
	});
	const values = new Map<string, string>();
	for (const node of parsed.program.body) {
		if (
			node.type !== "ExportNamedDeclaration" ||
			node.declaration?.type !== "VariableDeclaration"
		) {
			continue;
		}
		for (const declaration of node.declaration.declarations) {
			if (
				declaration.id.type !== "Identifier" ||
				declaration.id.name !== name ||
				declaration.init?.type !== "ObjectExpression"
			) {
				continue;
			}
			for (const property of declaration.init.properties) {
				if (
					property.type !== "ObjectProperty" ||
					property.key.type !== "Identifier" ||
					property.value.type !== "StringLiteral"
				) {
					continue;
				}
				values.set(property.key.name, property.value.value);
			}
		}
	}
	return values;
}

function compiledVariables(code: string): Map<string, string> {
	const names = new Map<string, string>();
	for (const [key, value] of objectExport(code, "colours")) {
		if (value.startsWith("var(--") && value.endsWith(")")) {
			names.set(key, value.slice(4, -1));
		}
	}
	return names;
}

function tokenValues(source: string, name: string): Record<string, string> {
	return Object.fromEntries(objectExport(source, name));
}

function declarations(
	values: Record<string, string>,
	names: Map<string, string>,
): string {
	return Object.entries(values)
		.map(([key, value]) => {
			const name = names.get(key);
			return name === undefined ? "" : `${name}:${value}`;
		})
		.filter((item) => item !== "")
		.join(";");
}

function themeFromCompile(source: string, code: string): PageThemeMeta {
	const light = tokenValues(source, "lightValues");
	const dark = tokenValues(source, "darkValues");
	const names = compiledVariables(code);
	return {
		light: declarations(light, names),
		dark: declarations(dark, names),
		canvas: { light: light.canvas ?? "", dark: dark.canvas ?? "" },
		ink: { light: light.ink ?? "", dark: dark.ink ?? "" },
	};
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
		const path = realpathSync(resolve(rootDir, name));
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
			const next = output.get(realpathSync(args.path));
			if (next === undefined) {
				return undefined;
			}
			return { contents: next, loader: loaderFor(args.path) };
		});
	},
};

export default plugin;
