#!/usr/bin/env bun
import { version } from "../package.json";

if (process.argv.includes("--version")) {
	console.log(version);
}
