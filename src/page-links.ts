function pageHref(anchor: HTMLAnchorElement): string | null {
	if (anchor.target !== "" || anchor.hasAttribute("download")) {
		return null;
	}
	const href = anchor.getAttribute("href");
	if (href === null || href.startsWith("#") || href.startsWith("mailto:")) {
		return null;
	}
	const url = new URL(anchor.href, window.location.href);
	if (url.origin !== window.location.origin) {
		return null;
	}
	if (!url.pathname.startsWith("/") || url.pathname.startsWith("/api/")) {
		return null;
	}
	return `${url.pathname}${url.search}${url.hash}`;
}

export function installPageLinks(): void {
	document.addEventListener("click", (event) => {
		if (
			event.defaultPrevented ||
			event.button !== 0 ||
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey
		) {
			return;
		}
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}
		const anchor = target.closest("a");
		if (!(anchor instanceof HTMLAnchorElement)) {
			return;
		}
		const next = pageHref(anchor);
		if (next === null) {
			return;
		}
		const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
		if (next === current) {
			event.preventDefault();
			return;
		}
		event.preventDefault();
		window.history.pushState(null, "", next);
		window.dispatchEvent(new PopStateEvent("popstate"));
	});
}
