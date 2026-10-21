# Search pad shots

`walk_replay.py` pins the viewport at 1280 by 800. The pad walks that named 1440 and 390 did not set a width.

The 1440 and 390 shots were taken outside that replay. `bun proof/serve-jump.ts 4199` served recorded tracker responses, with `XDG_DATA_HOME` in a temporary folder. `agent-browser --session pf259pad set viewport 1440 900` took `.devkit/proof/item-2/pad-1440.png` (1440 by 900). `agent-browser --session pf259pad set viewport 390 844` took `.devkit/proof/item-2/pad-390.png` (390 by 844). Each shot opened the search, filled the long query, and waited for the long ticket title.
