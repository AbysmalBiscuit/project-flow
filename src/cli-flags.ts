import { isAbsolute, resolve } from "node:path";

import type { Factory } from "./configuration.ts";
import { flagFactory } from "./factories.ts";

const valueFlags = ["--config", "--host", "--port", "--factory"];
const switchFlags = ["--help", "--version", "--open"];

export const usage = `Usage: project-flow [flags]

  --config <file>  configuration file
  --host <host>    host to listen on (default 127.0.0.1)
  --port <port>    port to listen on
  --factory [<name>=]<url>
                   factory to read workcell runs from (repeatable);
                   the name defaults to the URL's host
  --open           open the printed URL in the default browser
  --version        print the version
  --help           print this help`;

export type Flags = {
	configFlag: string | undefined;
	hostFlag: string | undefined;
	portFlag: string | undefined;
	flagFactories: Factory[];
};

function unknownFlag(args: string[]): string | undefined {
	for (let index = 0; index < args.length; index++) {
		const arg = args[index] ?? "";
		if (valueFlags.includes(arg)) {
			index++;
		} else if (arg.startsWith("-") && !switchFlags.includes(arg)) {
			return arg;
		}
	}
	return undefined;
}

function flagValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) {
		return undefined;
	}
	return args[index + 1];
}

/** The value flags of a launch, or the error that names the first bad flag. */
export function parseFlags(args: string[]): Flags | { error: string } {
	const unknown = unknownFlag(args);
	if (unknown !== undefined) {
		return { error: `unknown flag: ${unknown} (see --help)` };
	}

	const configFlag = flagValue(args, "--config");
	if (
		args.includes("--config") &&
		(configFlag === undefined ||
			configFlag.trim() === "" ||
			configFlag.startsWith("--"))
	) {
		return { error: "invalid configuration: --config needs a file path" };
	}

	const portFlag = flagValue(args, "--port");
	const hostFlag = flagValue(args, "--host");
	if (
		args.includes("--port") &&
		(portFlag === undefined ||
			!/^\d+$/.test(portFlag) ||
			Number(portFlag) > 65535)
	) {
		return { error: "invalid port: --port needs a port number" };
	}
	if (
		args.includes("--host") &&
		(hostFlag === undefined || hostFlag.startsWith("--"))
	) {
		return { error: "invalid host: --host needs a host name" };
	}

	const flagFactories: Factory[] = [];
	for (const [index, arg] of args.entries()) {
		if (arg !== "--factory") continue;
		const factory = flagFactory(args[index + 1] ?? "");
		if ("error" in factory) {
			return factory;
		}
		flagFactories.push(factory);
	}
	return { configFlag, hostFlag, portFlag, flagFactories };
}

export function configArgsForCheckout(
	args: string[],
	callerDir: string,
): string[] {
	const next = [...args];
	const index = next.indexOf("--config");
	const value = next[index + 1];
	if (
		index === -1 ||
		value === undefined ||
		value.trim() === "" ||
		value.startsWith("--")
	) {
		return next;
	}
	const trimmed = value.trim();
	if (isAbsolute(trimmed)) {
		next[index + 1] = trimmed;
		return next;
	}
	next[index + 1] = resolve(callerDir, trimmed);
	return next;
}
