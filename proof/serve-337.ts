import { serveProxy } from "./serve-proxy.ts";

await serveProxy(
	process.argv[2] ?? "4337",
	process.argv[3] ?? "proof/serve-graph-flows.ts",
);
