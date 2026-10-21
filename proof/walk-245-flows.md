# Graph flow walks

The walks serve recorded tracker responses through `proof/serve-graph-flows.ts`. That script sets `XDG_DATA_HOME` to a temporary folder. Do not call a live tracker.

The board is `acme/widget`. Two chains sit in it: `#11` to `#12` to `#13`, and `#1` to `#2` to `#3`. `#21` and `#22` both block `#20`. `#90` has no edge. `acme/alpha`, `acme/beta` and `acme/gamma` form one overview chain. `acme/beta` also has a ticket with no edge.

Item 1, left to right at 1440. Replay `proof/walk-245-item-1.json`.

`walk_replay.py` writes 1280 by 800 into `proofshot.config.json` in its own replay directory and ignores a viewport field. ProofShot reads that file. A worktree `proofshot.config.json` does not change the shot.

`#11`, `#12` and `#13` share one row. `#1`, `#2` and `#3` share a later row. No arrow inside either chain crosses another. `#21` and `#22` sit on two rows, and `#20` sits on one of those rows. `#90` sits after every flow.

Item 2, top to bottom at 1440. Replay `proof/walk-245-item-2.json`.

The same chains read top to bottom. `#1` sits above `#2`, and `#2` sits above `#3`. `#11` sits above `#12`, and `#12` sits above `#13`. Each chain keeps its own column. `#90` sits after the flows.

Item 3, group boxes and the overview. Replay `proof/walk-245-item-3.json`, then `proof/walk-245-item-3b.json`.

`proof/walk-245-item-3.json` turns Group by to Workstream. Alpha and Beta each keep their chains on one row inside the group box. The legend sits above the first group header and the first ticket. The overview graph puts `acme/alpha`, `acme/beta` and `acme/gamma` on one row. `acme/beta` stays on that row because it has an edge.

`proof/walk-245-item-3b.json` opens the same board with Group by Workstream and Top to bottom already saved. Each chain stays on one column inside its group box. The direction probe reads `top-to-bottom`.

Item 4, the same places after a reload. Replay `proof/walk-245-item-4.json`.

The first shot and the shot after reload show the same ticket rows. The places probe under the graph names the same coordinates both times.
