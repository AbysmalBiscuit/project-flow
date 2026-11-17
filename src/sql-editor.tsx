import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, type ReactNode, useRef } from "react";

import { control } from "./control-styles.ts";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const sqlKeywords = new Set(
	"select from where group by having order limit offset as and or not in is null like glob between case when then else end join left right inner outer cross on using with union all distinct asc desc insert update delete values set create table view index drop alter pragma exists cast collate recursive over partition window filter".split(
		" ",
	),
);

const sqlToken =
	/(--[^\n]*)|('(?:[^']|'')*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?/g;

const styles = stylex.create({
	box: {
		boxSizing: "border-box",
		display: "block",
		width: "100%",
		margin: 0,
		padding: space.md,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderRadius: radius.menu,
		fontFamily: font.mono,
		fontSize: type.small,
		lineHeight: type.line,
		letterSpacing: 0,
		whiteSpace: "pre-wrap",
		overflowWrap: "anywhere",
		tabSize: 4,
	},
	// The global stylesheet makes a textarea inherit its font and colour, and it
	// outranks layered StyleX rules, so the textarea takes both from here.
	wrap: {
		position: "relative",
		backgroundColor: colours.surface,
		borderRadius: radius.menu,
		color: "transparent",
		fontFamily: font.mono,
	},
	highlight: {
		position: "absolute",
		inset: 0,
		overflow: "hidden",
		pointerEvents: "none",
		color: colours.ink,
		borderColor: "transparent",
	},
	editor: {
		position: "relative",
		backgroundColor: "transparent",
		color: "transparent",
		caretColor: colours.ink,
		borderColor: colours.laneLine,
		minHeight: measure.insightEditor,
		resize: "vertical",
	},
	keyword: {
		color: colours.done,
		fontWeight: type.weight,
	},
	call: {
		color: colours.chipInk,
	},
	text: {
		color: colours.awaitingMerge,
	},
	number: {
		color: colours.warn,
	},
	comment: {
		color: colours.inkSoft,
		fontStyle: "italic",
	},
	table: {
		color: colours.accent,
	},
});

/** Splits SQL into text and coloured spans. The spans follow the keyword set and the `tables` names. */
export function highlightSql(
	sql: string,
	tables: ReadonlySet<string>,
): ReactNode[] {
	const nodes: ReactNode[] = [];
	let last = 0;
	for (const match of sql.matchAll(sqlToken)) {
		const [all, comment, text, number, word = "", call] = match;
		const index = match.index;
		nodes.push(sql.slice(last, index));
		last = index + all.length;
		if (comment) {
			nodes.push(
				<span key={index} className={clsx(styles.comment)}>
					{comment}
				</span>,
			);
		} else if (text) {
			nodes.push(
				<span key={index} className={clsx(styles.text)}>
					{text}
				</span>,
			);
		} else if (number) {
			nodes.push(
				<span key={index} className={clsx(styles.number)}>
					{number}
				</span>,
			);
		} else if (sqlKeywords.has(word.toLowerCase())) {
			nodes.push(
				<span key={index} className={clsx(styles.keyword)}>
					{word}
				</span>,
			);
			nodes.push(call ?? "");
		} else if (call) {
			nodes.push(
				<span key={index} className={clsx(styles.call)}>
					{word}
				</span>,
			);
			nodes.push(call);
		} else if (tables.has(word)) {
			nodes.push(
				<span key={index} className={clsx(styles.table)}>
					{word}
				</span>,
			);
		} else {
			nodes.push(all);
		}
	}
	nodes.push(sql.slice(last));
	// A trailing newline needs a character after it, or the copy is one line short of the textarea.
	nodes.push(" ");
	return nodes;
}

/** A SQL editor: a transparent textarea over a highlighted copy of its text. Ctrl or Cmd + Enter runs the query. */
export function SqlEditor({
	value,
	onChange,
	onRun,
	tables,
	label,
}: {
	value: string;
	onChange: (sql: string) => void;
	onRun: () => void;
	tables: ReadonlySet<string>;
	label: string;
}) {
	const highlightRef = useRef<HTMLPreElement>(null);

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			onRun();
		}
	}

	return (
		<div className={clsx(styles.wrap)}>
			<pre
				aria-hidden="true"
				ref={highlightRef}
				className={clsx(styles.box, styles.highlight)}
			>
				{highlightSql(value, tables)}
			</pre>
			<textarea
				aria-label={label}
				spellCheck={false}
				className={clsx(styles.box, styles.editor, control.focus)}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={handleKeyDown}
				onScroll={(event) => {
					if (highlightRef.current) {
						highlightRef.current.scrollTop = event.currentTarget.scrollTop;
					}
				}}
			/>
		</div>
	);
}
