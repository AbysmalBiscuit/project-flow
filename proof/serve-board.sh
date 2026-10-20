#!/bin/sh
cd /home/factory/git/github/AbysmalBiscuit/project-flow_workspaces/feat-project-board-with-a-ticket-side || exit 1
exec bun proof/serve-board.ts
