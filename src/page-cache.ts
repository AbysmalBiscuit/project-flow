import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";

let root: Root | null = null;

export function mountPage(render: (root: Root) => void): void {
	const host = document.getElementById("root");
	if (host === null) {
		return;
	}
	root ??= createRoot(host);
	render(root);
}
