// Serves the proof app behind a proxy that refuses each settings write
// with the 400 body the app sends for an invalid write.
const portFlag = process.argv.indexOf("--port");
const port = Number(
	(portFlag === -1 ? undefined : process.argv[portFlag + 1]) ??
		process.env.PORT ??
		"4764",
);
const appPort = port + 1;
const app = Bun.spawn(
	[
		"bun",
		"run",
		new URL("proof-serve.ts", import.meta.url).pathname,
		"--port",
		String(appPort),
	],
	{ stdout: "inherit", stderr: "inherit" },
);

async function appAnswers(): Promise<void> {
	for (;;) {
		const answered = await fetch(`http://127.0.0.1:${appPort}/`).catch(
			() => null,
		);
		if (answered?.ok) {
			return;
		}
		await Bun.sleep(100);
	}
}

await appAnswers();

const server = Bun.serve({
	hostname: "127.0.0.1",
	port,
	idleTimeout: 0,
	fetch: (request) => {
		const url = new URL(request.url);
		if (url.pathname === "/api/settings" && request.method === "PUT") {
			return Response.json(
				{ error: "pollIntervalSeconds: refused by the proof server" },
				{ status: 400 },
			);
		}
		url.host = `127.0.0.1:${appPort}`;
		return fetch(new Request(url, request));
	},
});
console.log(`http://127.0.0.1:${server.port}/`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		app.kill();
		process.exit(0);
	});
}
await app.exited;
