import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";

import { control } from "./control-styles.ts";
import type { RunEventsEnd, RunLogEvent, ShownFactoryRun } from "./domain.ts";
import { Loading } from "./loading.tsx";
import { panel } from "./panel-styles.ts";
import { NotServed } from "./run-checkpoint.tsx";
import {
	noRunEventsLabel,
	runEventsEndLabel,
	runEventsLabel,
	runTabData,
} from "./terms.ts";
import {
	colours,
	font,
	measure,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const styles = stylex.create({
	list: {
		display: "flex",
		flexDirection: "column",
		margin: `0 0 ${space.md}`,
		padding: 0,
		listStyle: "none",
	},
	item: {
		paddingBlock: space.xs,
		borderBottomWidth: measure.hairline,
		borderBottomStyle: "solid",
		borderBottomColor: colours.laneLine,
		fontSize: type.meta,
	},
	row: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "baseline",
		cursor: "default",
	},
	openable: {
		cursor: "pointer",
	},
	time: {
		color: colours.inkSoft,
		fontFamily: font.mono,
	},
	event: {
		color: colours.ink,
		fontWeight: type.weight,
	},
	stage: {
		color: colours.inkSoft,
		overflowWrap: "anywhere",
	},
	data: {
		margin: `${space.xs} 0 0`,
		padding: space.sm,
		overflowX: "auto",
		borderRadius: radius.sm,
		backgroundColor: colours.surfaceMuted,
		color: colours.ink,
		fontFamily: font.mono,
		fontSize: type.meta,
		whiteSpace: "pre-wrap",
		overflowWrap: "anywhere",
	},
});

function eventTime(at: string): string {
	const parsed = new Date(at);
	return Number.isNaN(parsed.getTime())
		? ""
		: parsed.toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});
}

function hasData(data: unknown): boolean {
	return (
		data !== null &&
		data !== undefined &&
		!(typeof data === "object" && Object.keys(data).length === 0)
	);
}

function EventRow({ event }: { event: RunLogEvent }) {
	const summary = (
		<>
			<time className={clsx(styles.time)} dateTime={event.at}>
				{eventTime(event.at)}
			</time>
			<span className={clsx(styles.event)}>{event.event}</span>
			{event.stage === "" ? null : (
				<span className={clsx(styles.stage)}>{event.stage}</span>
			)}
		</>
	);
	if (!hasData(event.data)) {
		return <div className={clsx(styles.row)}>{summary}</div>;
	}
	return (
		<details>
			<summary
				className={clsx(
					styles.row,
					styles.openable,
					control.clear,
					control.bleed,
					control.focus,
				)}
			>
				{summary}
			</summary>
			<pre className={clsx(styles.data)}>
				{JSON.stringify(event.data, null, 2)}
			</pre>
		</details>
	);
}

/**
 * Every event of the run since its start, then its new events as they come.
 * The browser sends the id of the last event when it connects again, so the
 * stream goes on after that event.
 */
export function RunEvents({ run }: { run: ShownFactoryRun }) {
	const [events, setEvents] = useState<RunLogEvent[]>([]);
	const [end, setEnd] = useState<RunEventsEnd | null>(null);
	useEffect(() => {
		setEvents([]);
		setEnd(null);
		const source = new EventSource(
			`/api/factory-runs/${encodeURIComponent(run.id)}/events`,
		);
		// The replay sends many events at once, so the view shows them once a frame.
		let pending: RunLogEvent[] = [];
		let frame: number | null = null;
		const flush = () => {
			frame = null;
			const added = pending;
			pending = [];
			setEvents((shown) => [...shown, ...added]);
		};
		source.addEventListener("message", (message: MessageEvent<string>) => {
			pending.push(JSON.parse(message.data) as RunLogEvent);
			frame ??= requestAnimationFrame(flush);
		});
		source.addEventListener("end", (message: MessageEvent<string>) => {
			source.close();
			if (frame !== null) {
				cancelAnimationFrame(frame);
				flush();
			}
			setEnd(JSON.parse(message.data) as RunEventsEnd);
		});
		return () => {
			source.close();
			if (frame !== null) {
				cancelAnimationFrame(frame);
			}
		};
	}, [run.id]);
	if (end?.reason === "not served") {
		return <NotServed data={runTabData.events} />;
	}
	if (events.length === 0 && end === null) {
		return <Loading />;
	}
	return (
		<>
			<h3 className={clsx(panel.sectionLabel)}>{runEventsLabel}</h3>
			{events.length === 0 ? (
				<p className={clsx(panel.note)}>{noRunEventsLabel}</p>
			) : (
				<ol className={clsx(styles.list)} aria-label={runEventsLabel}>
					{events.map((event) => (
						<li key={event.id} className={clsx(styles.item)}>
							<EventRow event={event} />
						</li>
					))}
				</ol>
			)}
			{end === null ? null : (
				<p className={clsx(panel.note)}>{runEventsEndLabel[end.reason]}</p>
			)}
		</>
	);
}
