#!/bin/sh
# A full suite holds one machine slot until this process exits.
# A path or a name filter is not a full suite and takes no slot.
set -eu

full=1
for arg in "$@"; do
	case "$arg" in
	-t | --test-name-pattern | --test-name-pattern=* | -g | --todo) full=0 ;;
	-*) ;;
	*) full=0 ;;
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
if [ ! -d "$dir" ]; then
	mkdir -m 1777 "$dir"
fi
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
