import { createRoot } from "react-dom/client";

import { onAppEvent } from "./events.ts";
import { reloadLabel, restartedMessage } from "./terms.ts";
import { Toast } from "./toast.tsx";

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

/** Reloads the page when the server restarts, or offers a reload while a field has focus. */
export function watchServerBoot(): void {
	let firstBootId: string | undefined;
	let restartToastShown = false;
	onAppEvent("boot", (event) => {
		const bootId = String(event.data);
		firstBootId ??= bootId;
		if (bootId === firstBootId || restartToastShown) {
			return;
		}
		const focused = document.activeElement;
		if (
			focused instanceof HTMLInputElement ||
			focused instanceof HTMLTextAreaElement
		) {
			restartToastShown = true;
			mountRestartToast();
			return;
		}
		window.location.reload();
	});
}
