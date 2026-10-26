# Show run detail on a run page

Project Flow shows the detail of a workcell run on a run page, in tabs. The side panel of a ticket keeps a summary of its run: the run facts, the run agents, the run thread, the answer and steer boxes, and the run actions. The side panel links to the run page. The Runs list, the ticket card and Ctrl-click also open the run page.

## Considered options

- More sections in the side panel. The panel has no room for a stage transcript, a diff or an event log.
- A wide drawer over the board. It hides the board, and Lev cannot link to it.

## Consequences

The run graph, the run stages and the run usage move from the side panel to the run page. Each tab reads one factory route. A tab shows an empty state when the factory does not serve its route. Project Flow keeps no run history: the factory serves the history of a run. Shift-click sets the focus set, because Ctrl-click opens the run page.
