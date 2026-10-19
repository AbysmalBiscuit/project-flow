export {};

if (window.location.pathname.startsWith("/projects/")) {
	await import("./project.tsx");
} else {
	await import("./cards.tsx");
}
