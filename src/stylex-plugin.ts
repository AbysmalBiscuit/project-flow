import { readFileSync, realpathSync } from "node:fs";
import { rename } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import type { PluginItem } from "@babel/core";
import parser from "@babel/parser";
import type { BunPlugin } from "bun";

const loadedPlugin = (name: string): PluginItem => {
	const path = require.resolve(name);
	const loaded = require(path) as { default?: PluginItem };
	return loaded.default ?? (loaded as PluginItem);
};

// The server imports this module for pageThemeMeta. Babel and the StyleX
// plugin load only when a build compiles, so a server start stays cheap.
let compilers: Promise<{
	babel: typeof import("@babel/core");
	stylexBabelPlugin: typeof import("@stylexjs/babel-plugin").default;
}> | null = null;

function loadedCompilers() {
	compilers ??= Promise.all([
		import("@babel/core"),
		import("@stylexjs/babel-plugin"),
	]).then(([babel, stylex]) => ({
		babel,
		stylexBabelPlugin: stylex.default,
	}));
	return compilers;
}

const rootDir = realpathSync(resolve(import.meta.dir, ".."));

type Rules = ReadonlyArray<readonly unknown[]>;
type Compiled = { readonly output: string; readonly rules: Rules };

const rules = new Map<string, Rules>();

// Each test file runs in a fresh global, so the compile output also lives on
// disk. The key covers the source, the lockfile and this file.
const cacheDir = resolve(rootDir, "node_modules/.cache/project-flow-stylex");
const cacheSalt = [
	readFileSync(import.meta.path, "utf8"),
	readFileSync(resolve(rootDir, "bun.lock"), "utf8"),
].join("\0");

function cacheKey(...parts: string[]): string {
	return new Bun.CryptoHasher("sha256")
		.update([cacheSalt, ...parts].join("\0"))
		.digest("hex");
}

async function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
	const path = join(cacheDir, `${key}.json`);
	try {
		return (await Bun.file(path).json()) as T;
	} catch {
		const value = await make();
		const written = `${path}.${crypto.randomUUID()}`;
		await Bun.write(written, JSON.stringify(value));
		await rename(written, path);
		return value;
	}
}

function record(filename: string, compiled: Compiled): void {
	if (compiled.rules.length > 0) {
		rules.set(filename, compiled.rules);
	} else {
		rules.delete(filename);
	}
	if (filename.endsWith("/tokens.stylex.ts")) {
		themeMeta = themeFromCompile(compiled.output);
	}
}

async function compile(code: string, filename: string): Promise<Compiled> {
	const { babel, stylexBabelPlugin } = await loadedCompilers();
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
	const metadata = result?.metadata as { stylex?: Rules } | undefined;
	return { output: result?.code ?? code, rules: metadata?.stylex ?? [] };
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

const tokenSource = readFileSync(
	resolve(rootDir, "src/tokens.stylex.ts"),
	"utf8",
);
const lightTokenData = Object.fromEntries(
	objectExport(tokenSource, "lightValues"),
);
const darkTokenData = Object.fromEntries(
	objectExport(tokenSource, "darkValues"),
);

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

function themeFromCompile(code: string): PageThemeMeta {
	const light = lightTokenData;
	const dark = darkTokenData;
	const names = compiledVariables(code);
	return {
		light: declarations(light, names),
		dark: declarations(dark, names),
		canvas: { light: light.canvas ?? "", dark: dark.canvas ?? "" },
		ink: { light: light.ink ?? "", dark: dark.ink ?? "" },
	};
}

async function collectedCss(): Promise<string> {
	const flat = [...rules.values()].flat();
	if (flat.length === 0) {
		return "";
	}
	return cached(cacheKey(JSON.stringify(flat)), async () => {
		const { stylexBabelPlugin } = await loadedCompilers();
		return stylexBabelPlugin.processStylexRules(
			flat as Parameters<typeof stylexBabelPlugin.processStylexRules>[0],
			{ useLayers: true },
		);
	});
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

// Each server build compiles the tree again. A file whose source did not
// change keeps its last output and rules.
const lastCompiled = new Map<string, { code: string; compiled: Compiled }>();

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
		let last = lastCompiled.get(path);
		if (last?.code !== code) {
			last = {
				code,
				compiled: await cached(cacheKey(relative(rootDir, path), code), () =>
					compile(code, path),
				),
			};
			record(path, last.compiled);
			lastCompiled.set(path, last);
		}
		output.set(path, last.compiled.output);
	}
	for (const path of [...rules.keys(), ...lastCompiled.keys()]) {
		if (!output.has(path)) {
			rules.delete(path);
			lastCompiled.delete(path);
		}
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
		build.onLoad({ filter: /\.css$/ }, async (args) => {
			await compiledTree();
			const source = await Bun.file(args.path).text();
			return { contents: `${source}\n${await collectedCss()}`, loader: "css" };
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
