# elkjs for the project graph layout

The project graph frames each parent ticket around its sub-tickets, and frames nest to any depth. The hand-written layout cannot do this. It places all tickets on one global grid, then cuts each group out of that grid. A group frame keeps the empty cells of other groups, so a large project scatters. elkjs lays out a graph with nested frames. Layered uses the ELK `layered` algorithm. Force uses d3-force with two frame forces. Each layout runs in a Web Worker.

The spike in issue 349 measured both layouts on the recorded tickets of project-flow, `AbysmalBiscuit/workcell` and the Linear project Initial SDI Issues. The issue comment holds the tables. `proof/elk-spike/capture.ts` records the data again, and `proof/elk-spike/measure.ts` prints the tables again.

## Considered options

- The hand-written layout. It has no nested frames. On workcell, a ticket fills less than a fifth of the cells of its group frame. ELK `layered` with `SEPARATE_CHILDREN` fills about three times that share. With `INCLUDE_CHILDREN`, it fills almost twice that share.
- dagre. It lays out layers, but it gives no option to bound a layer or to pack the loose tickets of a frame. A fan-out stays one tall column, as in the hand-written layout.
- ELK `stress` for Force. It lays out each frame alone and ignores the arrows that cross frames. Frames stay intact only because the top level has no arrows. Cards overlap, and arrows across frames become long lines over the graph. When the arrows move up to the frame level, `stress` puts frames on top of each other.
- d3-force for Layered. It has no layers, so the left-to-right reading order of blockers goes away.
- WebCola. Its group constraints keep frames apart. But it is a second layout model, and it has no layered mode. It gets no maintenance. d3-force with a frame force passed the same frame check.

## Decision

- Layered uses elkjs `layered`.
- Force uses d3-force. One force pulls the members of each frame together. A second force pushes overlapping sibling frames apart, and a final pass removes the overlaps that stay.
- The app loads `elkjs/lib/elk-api.js` and starts `elkjs/lib/elk-worker.min.js` in a real Worker. The bundled `elk.bundled.js` fails in Bun, because its fake worker finds no `Worker` class.

## Consequences

- `elkjs` and `d3-force` are dependencies. The elkjs licence is EPL-2.0 or GPL-3.0-or-later, so it fits the GPL-3.0 licence of this app.
- The Layered options follow the spike tables. `INCLUDE_CHILDREN` lets arrows across frames shape the layout and gives routes for them. But the groups spread out. `SEPARATE_CHILDREN` fills the groups best and wraps a fan-out. A Coffman-Graham layer bound adds fill only with nested frames on Group by Workstream. With `SEPARATE_CHILDREN`, ELK gives no route for an arrow across groups.
- With straight arrows, most arrows across frames on workcell cross a card in every layout. d3-force crosses a card with 65 of 82 arrows on Workstream and 75 of 99 on Theme. So the app must route the arrows across frames.
- The d3-force frame forces are app code. The browser proof of each layout change checks that each sub-ticket stays inside its frame and that sibling frames do not overlap.
