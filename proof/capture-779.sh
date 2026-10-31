#!/usr/bin/env bash
# Captures the shots of ticket 779 from the merge base and from HEAD, and records both in proof/item-779/CAPTURES.md.
# Usage: proof/capture-779.sh
set -euo pipefail

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
out="$repo/proof/item-779"
head=$(git -C "$repo" rev-parse HEAD)
base=$(git -C "$repo" merge-base origin/main HEAD)
base_tree=$(mktemp -d)
base_port=4780
head_port=4779
pids=()

cleanup() {
	for pid in "${pids[@]}"; do
		kill "$pid" 2>/dev/null || true
	done
	rm -rf "$base_tree"
}
trap cleanup EXIT

git -C "$repo" archive "$base" | tar -x -C "$base_tree"
ln -s "$repo/node_modules" "$base_tree/node_modules"
cp "$repo/proof/serve-779.ts" "$repo/proof/recorded.ts" "$base_tree/proof/"

serve() {
	(cd "$1" && exec bun proof/serve-779.ts "$2") >/dev/null 2>&1 &
	pids+=($!)
	for _ in $(seq 1 120); do
		[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$2/api/overview")" = 200 ] && return
		sleep 0.25
	done
	echo "the app on port $2 did not start" >&2
	exit 1
}

section() {
	agent-browser scrollintoview "#$1" >/dev/null
	agent-browser wait 500 >/dev/null
	agent-browser screenshot "#$1" "$out/settings-$1-$2.png" >/dev/null
}

panel() {
	agent-browser open "$2" >/dev/null
	agent-browser wait "[data-comment]" >/dev/null
	agent-browser wait 1500 >/dev/null
	agent-browser screenshot "$out/panel-$1-$3.png" >/dev/null
}

capture() {
	local url="http://127.0.0.1:$1"
	local label=$2
	agent-browser set viewport 1440 1000 >/dev/null
	agent-browser open "$url/" >/dev/null
	agent-browser wait 1500 >/dev/null
	agent-browser screenshot "$out/overview-$label.png" >/dev/null
	agent-browser open "$url/settings" >/dev/null
	agent-browser wait "#trackers" >/dev/null
	agent-browser wait 800 >/dev/null
	for name in general states review trackers factories; do
		section "$name" "$label"
	done
	agent-browser scrollintoview "#project-filter" >/dev/null
	agent-browser click "#project-filter" >/dev/null
	agent-browser wait "#project-filters" >/dev/null
	section projects "$label"
	panel github "$url/projects/acme%2Fwidget?ticket=acme%2Fwidget%234&panelProject=acme%2Fwidget&panelTracker=github" "$label"
	panel linear "$url/projects/Widget%20launch?ticket=WID-1&panelProject=Widget%20launch&panelTracker=linear" "$label"
}

serve "$base_tree" "$base_port"
serve "$repo" "$head_port"
capture "$base_port" before
capture "$head_port" after

{
	echo "# Captures of ticket 779"
	echo
	echo "\`proof/capture-779.sh\` wrote this file. Run the script again to regenerate it."
	echo
	echo "- Each \`*-before.png\` shows the merge base \`$base\`."
	echo "- Each \`*-after.png\` shows \`$head\`."
	echo "- The base tree serves \`proof/serve-779.ts\` and \`proof/recorded.ts\` of the second revision."
	echo
	echo "| Shot | Before sha256 | After sha256 | Same |"
	echo "|---|---|---|---|"
	for before in "$out"/*-before.png; do
		name=$(basename "$before" -before.png)
		left=$(sha256sum "$before" | awk '{print $1}')
		right=$(sha256sum "$out/$name-after.png" | awk '{print $1}')
		same=no
		[ "$left" = "$right" ] && same=yes
		echo "| $name | \`$left\` | \`$right\` | $same |"
	done
} >"$out/CAPTURES.md"
