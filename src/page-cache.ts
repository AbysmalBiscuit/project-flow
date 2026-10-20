import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";

const entries = new Map<string, unknown>();

export function readPageCache(key: string): unknown {
	return entries.get(key);
}

export function writePageCache(key: string, body: unknown): void {
	entries.set(key, body);
}

let root: Root | null = null;
let owner: symbol | null = null;

export function claimPage(): symbol {
	owner = Symbol();
	return owner;
}

export function mountPage(token: symbol, render: (root: Root) => void): void {
	if (token !== owner) {
		return;
	}
	const host = document.getElementById("root");
	if (host === null) {
		return;
	}
	root ??= createRoot(host);
	render(root);
}
