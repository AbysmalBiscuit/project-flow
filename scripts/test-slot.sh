#!/bin/sh
# A full suite holds one machine slot until this process exits.
# A path or a filter is not a full suite and takes no slot.
set -eu

full=1
expect=
for arg in "$@"; do
	if [ -n "$expect" ]; then
		expect=
		continue
	fi
	case "$arg" in
	-t | --test-name-pattern | --test-name-pattern=* | -g | --only | --shard | --shard=* | --changed | --changed=*)
		full=0
		;;
	--timeout | --rerun-each | --retry | --seed | --coverage-reporter | --coverage-dir | --bail | --reporter | --reporter-outfile | --max-concurrency | --path-ignore-patterns | --parallel | --parallel-delay | --timings)
		expect=1
		;;
	-*) ;;
	*[![:space:]]*) full=0 ;;
	esac
done

if [ "$full" -eq 0 ]; then
	exec bun test "$@"
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
	flock -n --conflict-exit-code 75 "$dir/slot-$slot.lock" bun test "$@"
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
