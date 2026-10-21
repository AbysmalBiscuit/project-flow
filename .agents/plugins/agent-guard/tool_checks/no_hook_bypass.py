#!/usr/bin/env python3
"""PreToolUse/Bash guard: a shell command that skips the git hooks."""

import json
import re
import shlex
import sys

OPERATOR = re.compile(r"^[|&;()<>{}\n]+$")
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z_0-9]*\+?=")
WRAPPERS = {
    "sudo",
    "command",
    "builtin",
    "exec",
    "env",
    "time",
    "timeout",
    "nice",
    "ionice",
    "stdbuf",
    "nohup",
    "watch",
    "noglob",
    "then",
    "do",
    "else",
    "elif",
    "if",
    "while",
    "until",
    "!",
}
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
DURATION = re.compile(r"^\d+[smhd]?$")
GIT_OPTS_WITH_VALUE = {
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--exec-path",
}
# -c takes one config pair. The attached form is the same pair.
HOOKS_PATH = re.compile(r"(?:^|\s)core\.hooksPath(?:=|\s|$)", re.IGNORECASE)

MESSAGE = "The hook is the gate. Report the failure to your PM and stop."


class Segment:
    """One command position and the assignments that introduced it."""

    def __init__(self, name, args, assignments):
        self.name = name
        self.args = args
        self.assignments = assignments


def tokenize(command):
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    return list(lexer)


def segments(command, depth=0):
    """Every command position in the line. An unparseable line yields nothing."""
    if depth > 2:
        return []
    try:
        tokens = tokenize(command)
    except ValueError:
        return []

    found = []
    pending, current = [], None
    for i, token in enumerate(tokens):
        if OPERATOR.match(token):
            pending, current = [], None
            continue
        if current is None:
            if ASSIGNMENT.match(token):
                pending.append(token)
                continue
            if token in WRAPPERS or token.startswith("-") or DURATION.match(token):
                continue
            current = Segment(token.rsplit("/", 1)[-1], [], pending)
            pending = []
            found.append(current)
            continue
        current.args.append(token)
        if current.name in SHELLS and token == "-c" and i + 1 < len(tokens):
            found.extend(segments(tokens[i + 1], depth + 1))
    return found


def git_words(args):
    """The subcommand and the words after it. Global options are consumed."""
    rest, skip = [], False
    for arg in args:
        if skip:
            skip = False
            continue
        if arg in GIT_OPTS_WITH_VALUE:
            skip = True
            continue
        if arg.startswith("-") and not rest:
            continue
        rest.append(arg)
    return rest


def hooks_path(args):
    """A -c that sets core.hooksPath, in either spelling."""
    for index, arg in enumerate(args):
        if arg in ("-c", "--config") and index + 1 < len(args):
            if HOOKS_PATH.search(args[index + 1]):
                return True
        elif arg.startswith(("-c", "--config=")) and HOOKS_PATH.search(arg):
            return True
    return False


# A commit option that takes the next word, so that word is a message, not a flag.
COMMIT_TAKES_NEXT = {
    "-c",
    "-C",
    "-F",
    "-m",
    "--author",
    "--cleanup",
    "--date",
    "--file",
    "--fixup",
    "--message",
    "--pathspec-from-file",
    "--reedit-message",
    "--reuse-message",
    "--squash",
    "--template",
}
# The first of these letters in a short cluster consumes the rest of the cluster.
COMMIT_TAKES_VALUE = set("cCFmt")


def commit_no_verify(words):
    """-n on commit, alone or inside a short-flag cluster. -n on push is a dry run."""
    if not words or words[0] != "commit":
        return False
    skip = False
    for word in words[1:]:
        if skip:
            skip = False
            continue
        if word in ("--no-verify", "--no-verify=true"):
            return True
        if word.startswith("--"):
            if word.split("=", 1)[0] in COMMIT_TAKES_NEXT and "=" not in word:
                skip = True
            continue
        if len(word) > 1 and word[0] == "-":
            for letter in word[1:]:
                if letter == "n":
                    return True
                if letter in COMMIT_TAKES_VALUE:
                    break
            if word[1] in COMMIT_TAKES_VALUE and len(word) == 2:
                skip = True
    return False


def skip_assignment(assignments):
    """HUSKY=0 turns Husky off. SKIP= names the hooks a command skips."""
    for item in assignments:
        name, _, value = item.partition("=")
        if name == "HUSKY" and value == "0":
            return True
        if name == "SKIP" and value:
            return True
    return False


def bypass(segment):
    if segment.name != "git":
        return skip_assignment(segment.assignments)
    words = git_words(segment.args)
    if not words:
        return hooks_path(segment.args) or skip_assignment(segment.assignments)
    command = words[0]
    if command in ("commit", "push") and "--no-verify" in words:
        return True
    if commit_no_verify(words):
        return True
    if hooks_path(segment.args):
        return True
    return skip_assignment(segment.assignments)


def main():
    if (sys.argv[1] if len(sys.argv) > 1 else "") != "Bash":
        return 0
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        return 0
    command = str((payload.get("tool_input") or {}).get("command") or "")
    if not command.strip():
        return 0
    if any(bypass(segment) for segment in segments(command)):
        print(f"agent-guard: {MESSAGE}")
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException:
        sys.exit(0)
