import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import { onAppEvent } from "./events.ts";
import { reloadLabel, restartedMessage } from "./terms.ts";
import { Toast } from "./toast.tsx";

const holds = new Set<symbol>();

/** Offers a reload in place of the reload on a server restart while `held` is true, for example while a form holds unsaved edits. */
export function useHoldReload(held: boolean): void {
	useEffect(() => {
		if (!held) {
			return;
		}
		const hold = Symbol();
		holds.add(hold);
		return () => {
			holds.delete(hold);
		};
	}, [held]);
}

function mountRestartToast(): void {
	const host = document.createElement("div");
	host.style.display = "contents";
	document.body.append(host);
	createRoot(host).render(
		<Toast
			message={restartedMessage}
			tone="saved"
			action={{ label: reloadLabel, onClick: () => window.location.reload() }}
		/>,
	);
}

function editing(): boolean {
	const focused = document.activeElement;
	return (
		holds.size > 0 ||
		focused instanceof HTMLInputElement ||
		focused instanceof HTMLTextAreaElement
	);
}

/** Reloads the page when the server restarts, or offers a reload while a field has focus or a form holds unsaved edits. */
export function watchServerBoot(): void {
	let firstBootId: string | undefined;
	let restartToastShown = false;
	onAppEvent("boot", (event) => {
		const bootId = String(event.data);
		firstBootId ??= bootId;
		if (bootId === firstBootId || restartToastShown) {
			return;
		}
		if (editing()) {
			restartToastShown = true;
			mountRestartToast();
			return;
		}
		window.location.reload();
	});
}
