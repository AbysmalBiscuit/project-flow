#!/bin/sh
# A full suite or a pre-push run holds one machine slot until this process exits.
# A path or a filter from a caller is not a full suite and takes no slot.
set -eu

# bunfig.toml lives at the checkout. A caller outside it still loads the preload.
root=$(CDPATH= git -C "$(dirname "$0")" rev-parse --show-toplevel)

# The pre-push hook runs only the tests that the change affects.
# The rules come from origin/main, so a branch follows them without a rebase.
affected=
if [ "${1-}" = --affected ]; then
	affected=1
	shift
	set +e
	tests=$(
		cd "$root" &&
			{ git show origin/main:scripts/affected-tests.ts 2>/dev/null || cat scripts/affected-tests.ts; } |
			bun run -
	)
	status=$?
	set -e
	case "$status" in
	0)
		if [ -z "$tests" ]; then
			exit 0
		fi
		set -f
		# shellcheck disable=SC2086
		set -- $tests "$@"
		;;
	10) ;;
	*) echo "full suite: the test selection exited $status" >&2 ;;
	esac
fi

full=1
expect=
for arg in "$@"; do
	if [ -n "$expect" ]; then
		case "$expect" in
		bail)
			case "$arg" in
			*[!0-9]*) ;;
			"") ;;
			*)
				expect=
				continue
				;;
			esac
			;;
		*)
			expect=
			continue
			;;
		esac
		expect=
	fi
	case "$arg" in
	-t | --test-name-pattern | --test-name-pattern=* | -g | --only | --shard | --shard=* | --changed | --changed=*)
		full=0
		;;
	--bail | --bail=*)
		expect=bail
		;;
	--timeout | --rerun-each | --retry | --seed | --coverage-reporter | --coverage-dir | --reporter | --reporter-outfile | --max-concurrency | --path-ignore-patterns | --parallel | --parallel-delay | --timings)
		expect=1
		;;
	-*) ;;
	*[![:space:]]*) full=0 ;;
	esac
done

if [ "$full" -eq 0 ] && [ -z "$affected" ]; then
	exec bun test --cwd "$root" "$@"
fi

slots=$(($(nproc) / 4))
if [ "$slots" -lt 1 ]; then
	slots=1
fi

dir=/tmp/test-slots
mkdir -p -m 1777 "$dir"
chmod 1777 "$dir"

take() {
	slot=$1
	shift
	flock -n --conflict-exit-code 75 "$dir/slot-$slot.lock" bun test --cwd "$root" "$@"
}

i=0
while [ "$i" -lt "$slots" ]; do
	set +e
	take "$i" "$@"
	status=$?
	set -e
	if [ "$status" -ne 75 ]; then
		exit "$status"
	fi
	i=$((i + 1))
done

echo "waiting for a test slot"
while true; do
	i=0
	while [ "$i" -lt "$slots" ]; do
		set +e
		take "$i" "$@"
		status=$?
		set -e
		if [ "$status" -ne 75 ]; then
			exit "$status"
		fi
		i=$((i + 1))
	done
	sleep 0.2
done
