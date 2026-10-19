export {};

if (window.location.pathname === "/needs-you") {
	await import("./needs-you.tsx");
} else if (window.location.pathname.startsWith("/projects/")) {
	await import("./project.tsx");
} else {
	await import("./cards.tsx");
}
