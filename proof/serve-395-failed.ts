import { elkWorkerPath } from "../src/graph-core.ts";
import { serveProxy } from "./serve-proxy.ts";

/** An elk worker that rejects each layout, the way elkjs reports an error. */
const failingWorker = `self.onmessage = (event) => {
	self.postMessage({ id: event.data.id, error: "proof: the layout fails" });
};`;

await serveProxy(
	process.argv[2] ?? "4495",
	"proof/serve-graph-flows.ts",
	(url) =>
		url.pathname === elkWorkerPath
			? new Response(failingWorker, {
					headers: { "content-type": "text/javascript" },
				})
			: null,
);
