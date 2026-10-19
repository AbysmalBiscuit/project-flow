const calls: { body: string | undefined }[] = [];
const permissionCalls: number[] = [];

const NativeEventSource = window.EventSource;
window.EventSource = class extends NativeEventSource {
	constructor(url: string | URL, options?: EventSourceInit) {
		super(url, options);
		const target = String(url);
		if (new URL(target, location.href).pathname === "/api/events") {
			this.addEventListener("open", markOpen);
		}
	}
};

function Stub(
	this: unknown,
	_title: string,
	options?: { body?: string; tag?: string },
) {
	calls.push({ body: options?.body });
	if (document.body !== null) {
		line("notify-calls").textContent = `notify-calls ${calls.length} ${calls
			.map((call) => call.body ?? "")
			.join(" | ")}`;
	}
}

Stub.permission = "default" as NotificationPermission;
Stub.requestPermission = () => {
	permissionCalls.push(1);
	if (document.body !== null) {
		line("permission-calls").textContent =
			`permission-calls ${permissionCalls.length}`;
	}
	Stub.permission = "granted";
	void fetch("/api/proof/permission", { method: "POST" });
	return Promise.resolve("granted" as NotificationPermission);
};

Object.defineProperty(window, "Notification", {
	configurable: true,
	writable: true,
	value: Stub,
});

function line(id: string): HTMLElement {
	const current = document.getElementById(id);
	if (current !== null) {
		return current;
	}
	const node = document.createElement("p");
	node.id = id;
	document.body.appendChild(node);
	return node;
}

const nativeClick = HTMLElement.prototype.click;
function holdClickUntilNotified(this: HTMLElement): Promise<void> {
	nativeClick.call(this);
	const started = Date.now();
	return new Promise((resolve) => {
		const check = () => {
			const recorded = document
				.getElementById("notify-calls")
				?.textContent?.includes("notify-calls 1");
			const asked = document
				.getElementById("permission-calls")
				?.textContent?.includes("permission-calls 1");
			if (recorded === true || (asked === true && Date.now() - started > 300)) {
				resolve();
				return;
			}
			if (Date.now() - started > 4000) {
				resolve();
				return;
			}
			setTimeout(check, 50);
		};
		check();
	});
}

function attach(): void {
	const button = document.getElementById("notify-permission");
	if (button === null || button.click === holdClickUntilNotified) {
		return;
	}
	button.click = holdClickUntilNotified;
}

function markOpen(): void {
	const shown = line("event-stream");
	shown.textContent = "Event stream open";
	void fetch("/api/proof/stream-open", { method: "POST" });
}

function install(): void {
	line("permission-calls").textContent =
		`permission-calls ${permissionCalls.length}`;
	line("notify-calls").textContent = `notify-calls ${calls.length} ${calls
		.map((call) => call.body ?? "")
		.join(" | ")}`;
	attach();
	new MutationObserver(attach).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
}

if (document.body === null) {
	document.addEventListener("DOMContentLoaded", install, { once: true });
} else {
	install();
}
