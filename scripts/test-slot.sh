#!/bin/sh
# A full suite holds one machine slot until this process exits.
# A path or a filter is not a full suite and takes no slot.
set -eu

root=$(CDPATH= git -C "$(dirname "$0")" rev-parse --show-toplevel)
config_dir=${TMPDIR:-/var/tmp}/project-flow-git-config-$$
mkdir -p "$config_dir"
printf '[maintenance]\n\tauto = false\n' > "$config_dir/gitconfig"
export PROJECT_FLOW_TEST_GIT_CONFIG=$config_dir/gitconfig
export GIT_CONFIG_GLOBAL=$PROJECT_FLOW_TEST_GIT_CONFIG
export GIT_CONFIG_NOSYSTEM=1
unset XDG_RUNTIME_DIR
for name in $(env | sed -n 's/=.*//p'); do
	case $name in
	DBUS_*) unset "$name" ;;
	esac
done
export DBUS_SESSION_BUS_ADDRESS=unix:path=/session-bus-goes-nowhere

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

if [ "$full" -eq 0 ]; then
	exec bun test --preload "$root/test/preload.ts" "$@"
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
	flock -n --conflict-exit-code 75 "$dir/slot-$slot.lock" bun test --preload "$root/test/preload.ts" "$@"
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
