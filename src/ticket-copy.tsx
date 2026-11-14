import type { ReactNode } from "react";

import { useClipboard } from "./copy-text.tsx";
import type { FlowTicket } from "./graph-flow.ts";
import { useShortcut } from "./shortcuts.ts";
import { pullRef } from "./ticket-key.ts";

/** Binds the ticket copy shortcuts. Each copies one line per target ticket that has the value, and the result is the toast to render. */
export function useTicketCopy(targets: () => readonly FlowTicket[]): ReactNode {
	const clipboard = useClipboard();
	const copy = (value: (ticket: FlowTicket) => string | undefined) => {
		const lines = targets().flatMap((ticket) => {
			const line = value(ticket);
			return line === undefined ? [] : [line];
		});
		if (lines.length > 0) {
			clipboard.write(lines.join("\n"));
		}
	};
	useShortcut("copyTicketId", () => copy((ticket) => ticket.key));
	useShortcut("copyTicketUrl", () => copy((ticket) => ticket.url));
	useShortcut("copyPullId", () =>
		copy((ticket) =>
			ticket.pull === undefined ? undefined : pullRef(ticket.pull, ticket.key),
		),
	);
	useShortcut("copyPullUrl", () => copy((ticket) => ticket.pullUrl));
	return clipboard.toast;
}
