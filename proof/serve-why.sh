#!/bin/sh
trap '' HUP
root=/home/lev/git/github/AbysmalBiscuit/project-flow_workspaces/113-feat-show-why-an-item-needs-you
export BUN_CONFIG_PATH="$root/bunfig.toml"
cd "$root" || exit 1
exec bun proof/serve-why.ts "${1:-4175}"
