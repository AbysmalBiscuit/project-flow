import { createRoot } from "react-dom/client";
import { mountJumpBox } from "./jump.tsx";
import { watchNotifications } from "./notify.tsx";
import { PageFrame } from "./shell.tsx";
import { loadingLabel, navLabel } from "./terms.ts";
import { applyPageTheme, pageTheme } from "./theme.ts";
import "./global.css";

const shell = document.getElementById("root");
if (shell !== null && shell.childElementCount === 0) {
	const title =
		window.location.pathname === "/needs-you"
			? navLabel.needsYou
			: window.location.pathname === "/inbox"
				? navLabel.inbox
				: window.location.pathname === "/settings"
					? navLabel.settings
					: window.location.pathname.startsWith("/projects/")
						? decodeURIComponent(
								window.location.pathname.slice("/projects/".length),
							)
						: navLabel.overview;
	createRoot(shell).render(<PageFrame title={title}>{loadingLabel}</PageFrame>);
}

watchNotifications();
mountJumpBox();

applyPageTheme(pageTheme());

if (window.location.pathname === "/needs-you") {
	await import("./needs-you.tsx");
} else if (window.location.pathname === "/inbox") {
	await import("./inbox.tsx");
} else if (window.location.pathname === "/settings") {
	await import("./settings.tsx");
} else if (window.location.pathname.startsWith("/projects/")) {
	await import("./project.tsx");
} else {
	await import("./cards.tsx");
}
