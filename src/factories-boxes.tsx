import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState } from "react";

import { Fill, levelEdge, levelPill, Meter } from "./factories-host-meters.tsx";
import { HeartbeatDot, HostMeters } from "./factories-host-rows.tsx";
import type { FactoriesPage, FactoryCard } from "./factories-page.ts";
import { Source, styles } from "./factories-parts.tsx";
import { NotServed } from "./factories-tables.tsx";
import { factoriesCopy, spanText } from "./factories-terms.ts";
import { since } from "./factories-tiles.tsx";
import {
	colours,
	measure,
	media,
	radius,
	space,
	type,
} from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";

const boxStyles = stylex.create({
	boxes: {
		gridTemplateColumns: {
			default: `repeat(auto-fill, minmax(${measure.boxCardMin}, 1fr))`,
			[media.projectBar]: "minmax(0, 1fr)",
		},
	},
	band: {
		marginBottom: space.lg,
		padding: space.md,
		borderWidth: measure.hairline,
		borderStyle: "solid",
		borderColor: colours.laneLine,
		borderRadius: radius.md,
		backgroundColor: colours.groupFill,
	},
	bandHead: {
		display: "flex",
		flexWrap: "wrap",
		gap: space.sm,
		alignItems: "center",
		marginBottom: space.md,
	},
	bandGrid: {
		marginBottom: 0,
	},
	box: {
		borderLeftWidth: measure.boxEdge,
		borderLeftColor: colours.awaitingMerge,
	},
	boxOff: {
		borderLeftColor: colours.inkSoft,
		opacity: 0.6,
	},
	keptHeight: (height: string) => ({ minHeight: height }),
	meta: {
		display: "inline-flex",
		gap: space.sm,
		alignItems: "center",
		color: colours.inkSoft,
		fontSize: type.meta,
	},
	sourceRow: {
		display: "flex",
		gap: space.xs,
		justifyContent: "flex-end",
		marginBottom: space.sm,
	},
	meterSpan: {
		gridColumn: "1 / -1",
	},
});

/**
 * The box cards in bands: each hub that has boxes heads a band of its network,
 * and one band holds the standalone factories. Without a network, the cards
 * need no bands.
 */
export function BoxBands({ page, now }: { page: FactoriesPage; now: number }) {
	const grid = (boxes: FactoryCard[], inBand: boolean) => (
		<div
			className={clsx(
				styles.grid,
				boxStyles.boxes,
				inBand && boxStyles.bandGrid,
			)}
		>
			{boxes.map((box) => (
				<BoxCard key={box.name} box={box} page={page} now={now} />
			))}
		</div>
	);
	const members = Map.groupBy(
		page.boxes.filter((box) => box.network !== undefined),
		(box) => box.network,
	);
	const networks = page.boxes.filter((box) => members.has(box.name));
	if (networks.length === 0) {
		return grid(page.boxes, false);
	}
	const standalone = page.boxes.filter(
		(box) => box.network === undefined && !members.has(box.name),
	);
	return (
		<>
			{networks.map((hub) => {
				const boxes = members.get(hub.name) ?? [];
				return (
					<section
						key={hub.name}
						className={clsx(boxStyles.band)}
						aria-label={hub.name}
					>
						<div className={clsx(boxStyles.bandHead)}>
							<h2 className={clsx(styles.heading)}>{hub.name}</h2>
							<span className={clsx(styles.pill)}>{factoriesCopy.network}</span>
							<span className={clsx(boxStyles.meta)}>
								{factoriesCopy.networkSummary(
									boxes.length,
									boxes.filter((box) => box.reachable === true).length,
								)}
								{hub.slots === undefined || hub.reachable !== true
									? null
									: `, ${factoriesCopy.busy(hub.slots.used, hub.slots.total)}`}
							</span>
						</div>
						{grid([hub, ...boxes], true)}
					</section>
				);
			})}
			{standalone.length === 0 ? null : (
				<section
					className={clsx(boxStyles.band)}
					aria-label={factoriesCopy.standalone}
				>
					<div className={clsx(boxStyles.bandHead)}>
						<h2 className={clsx(styles.heading)}>{factoriesCopy.standalone}</h2>
					</div>
					{grid(standalone, true)}
				</section>
			)}
		</>
	);
}

/** The last height of each box card while its factory answered, kept for the life of the page. */
const answeredHeights = new Map<string, number>();

/**
 * Measures a box card while its factory answers. When the factory stops answering,
 * the card keeps that height, so the cards around it do not move.
 */
function useKeptHeight(name: string, answers: boolean) {
	const ref = useRef<HTMLElement>(null);
	const [kept, setKept] = useState(() => answeredHeights.get(name));
	useLayoutEffect(() => {
		const card = ref.current;
		if (!answers || card === null) {
			return;
		}
		const observer = new ResizeObserver(() => {
			answeredHeights.set(name, card.offsetHeight);
			setKept(card.offsetHeight);
		});
		observer.observe(card);
		return () => observer.disconnect();
	}, [name, answers]);
	return {
		ref,
		style: !answers && kept !== undefined && boxStyles.keptHeight(`${kept}px`),
	};
}

function BoxCard({
	box,
	page,
	now,
}: {
	box: FactoryCard;
	page: FactoriesPage;
	now: number;
}) {
	const heartbeat = since(box.heartbeatAt, now);
	const off = box.reachable !== true;
	const host = box.host;
	const lastKnown = box.slots !== undefined || host !== undefined;
	const hostNotServed = page.notServed.some(
		(item) => item.panel === "host" && item.factory === box.name,
	);
	const hubSilent =
		box.hub !== undefined &&
		page.boxes.find((other) => other.name === box.hub)?.reachable !== true;
	const dormant =
		!hubSilent && (box.state === "asleep" || box.state === "waking")
			? box.state
			: null;
	const slotTotal = box.slots?.total ?? 0;
	const kept = useKeptHeight(box.name, !off);
	return (
		<section
			ref={kept.ref}
			{...stylex.props(
				styles.card,
				boxStyles.box,
				host !== undefined && levelEdge[host.level],
				off && boxStyles.boxOff,
				kept.style,
			)}
			aria-label={box.name}
		>
			<div className={clsx(styles.head)}>
				<h2 className={clsx(styles.heading)}>{box.name}</h2>
				{box.roles.map((role) => (
					<span key={role} className={clsx(styles.pill)}>
						{factoriesCopy.role[role]}
					</span>
				))}
				{dormant !== null ? (
					<span className={clsx(styles.pill)}>
						{factoriesCopy.boxState[dormant]}
					</span>
				) : off ? (
					<span className={clsx(styles.pill, styles.pillBad)}>
						{factoriesCopy.noAnswer}
					</span>
				) : host === undefined ? null : (
					<span className={clsx(styles.pill, levelPill[host.level])}>
						{factoriesCopy.level[host.level]}
					</span>
				)}
				{box.state === "stopping" ? (
					<span className={clsx(styles.pill)}>
						{factoriesCopy.boxState.stopping}
					</span>
				) : null}
				{dormant !== null ? null : (
					<span className={clsx(boxStyles.meta)}>
						{host === undefined || off
							? null
							: factoriesCopy.uptime(spanText(host.uptimeS * 1_000))}
						{heartbeat === null ? (
							factoriesCopy.noHeartbeat
						) : (
							<HeartbeatDot
								key={box.heartbeatAt}
								at={box.heartbeatAt}
								span={heartbeat}
								now={now}
							/>
						)}
					</span>
				)}
			</div>
			<div className={clsx(boxStyles.sourceRow)}>
				{box.hub === undefined ? (
					<>
						<Source>{factoriesCopy.sources.daemon}</Source>
						<Source next>{factoriesCopy.hostSource}</Source>
					</>
				) : (
					<Source>{factoriesCopy.poolSource}</Source>
				)}
			</div>
			{dormant === "asleep" ? (
				<p className={clsx(styles.note)}>
					{factoriesCopy.asleep(slotTotal, heartbeat)}
				</p>
			) : dormant === "waking" ? (
				<p className={clsx(styles.note)}>{factoriesCopy.waking(slotTotal)}</p>
			) : off && !lastKnown ? (
				<p className={clsx(styles.note)}>
					{box.hub === undefined
						? factoriesCopy.unreachable(heartbeat !== null)
						: hubSilent
							? factoriesCopy.hubSilent
							: factoriesCopy.boxUnreachable(heartbeat !== null)}
				</p>
			) : (
				<HostMeters host={host}>
					{box.slots === undefined ? (
						<p className={clsx(styles.note, boxStyles.meterSpan)}>
							{factoriesCopy.noSlotCount}
						</p>
					) : (
						<Meter
							label={factoriesCopy.slots}
							value={factoriesCopy.busy(box.slots.used, box.slots.total)}
						>
							<span className={clsx(styles.bar)}>
								<Fill
									share={
										box.slots.total === 0
											? 0
											: Math.min(1, box.slots.used / box.slots.total)
									}
									tone={styles.stepCurrent}
								/>
							</span>
						</Meter>
					)}
					{host !== undefined ? null : hostNotServed ? (
						<div className={clsx(boxStyles.meterSpan)}>
							<NotServed page={page} panel="host" factory={box.name} />
						</div>
					) : (
						<p className={clsx(styles.note, boxStyles.meterSpan)}>
							{factoriesCopy.noHostSample}
						</p>
					)}
				</HostMeters>
			)}
		</section>
	);
}
