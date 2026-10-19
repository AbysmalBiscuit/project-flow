# React Flow for graphs

The overview and the project page draw dependency graphs. Mermaid renders a static diagram. A click on an edge or a node cannot open a ticket. The diagram cannot zoom or fit. React Flow with an automatic layout replaces Mermaid on both pages.

## Considered options

- Mermaid. The current renderer. The diagram is a picture. It has no click on an edge, no zoom, and no fit.
- A hand-drawn SVG graph. Full control, and a layout engine the app must own.
- Cytoscape.js or elk only. A layout or a canvas, without the node and edge controls the pages need.
- Keep Mermaid beside React Flow. Two graph libraries. Mermaid leaves the dependencies when both graphs move.

## Consequences

The overview graph and the project graph use React Flow. A click on an edge label opens the blocked ticket. Zoom, fit, and a direction switch live on the graph.
