/** Runs the d3-force candidate off the main thread, as the page would. */
import { forceLayout } from "./force.ts";
import type { SpikeGraph } from "./graph.ts";

declare const self: Worker;

self.onmessage = (event: MessageEvent<Omit<SpikeGraph, "tickets">>) => {
	self.postMessage(forceLayout(event.data));
};
