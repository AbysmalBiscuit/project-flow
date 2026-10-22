import { serveProxy } from "./serve-proxy.ts";

await serveProxy(
	process.argv[2] ?? "4359",
	process.argv[3] ?? "proof/serve-chain-group.ts",
);
