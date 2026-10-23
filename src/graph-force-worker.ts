import { forceLayout } from "./graph-force.ts";
import type { LayoutInput } from "./graph-layout.ts";
import type { NodeSize } from "./graph-sizes.ts";

/** The Force layout request: `titles` holds the extra height of each head card title. */
export type ForceRequest = {
	input: LayoutInput;
	card: NodeSize;
	titles: Map<string, number>;
};

declare const self: Worker;

self.onmessage = ({ data }: MessageEvent<ForceRequest>) => {
	self.postMessage(
		forceLayout(data.input, data.card, (title) => data.titles.get(title) ?? 0),
	);
};
