import * as stylex from "@stylexjs/stylex";
import {
	createContext,
	type MouseEvent,
	type ReactNode,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import { control } from "./control-styles.ts";
import { openProject } from "./paths.ts";
import { openProjectLabel } from "./terms.ts";
import { colours, measure, space } from "./tokens.stylex.ts";
import { frame } from "./ui-styles.ts";
import { clsx } from "./ui.ts";

export type MenuItem = {
	label: string;
	run: () => void;
};

type OpenMenu = {
	x: number;
	y: number;
	items: readonly MenuItem[];
	opener: HTMLElement;
};

const styles = stylex.create({
	menu: {
		position: "fixed",
		right: "auto",
		minWidth: "auto",
		margin: measure.none,
		boxShadow: `0 ${space.xs} ${space.md} ${colours.shadow}`,
	},
	at: (left: number, top: number) => ({
		left,
		top,
	}),
});

const OpenMenuContext = createContext<((menu: OpenMenu) => void) | null>(null);

/**
 * The context menu of the page. One menu is open at most. Escape, a pointer
 * down outside it, a scroll, a wheel turn or a resize closes it.
 */
export function ContextMenuHost({ children }: { children: ReactNode }) {
	const [menu, setMenu] = useState<OpenMenu | null>(null);
	const root = useRef<HTMLDivElement>(null);
	const [placed, setPlaced] = useState<{
		menu: OpenMenu;
		x: number;
		y: number;
	} | null>(null);
	useLayoutEffect(() => {
		const box = root.current?.getBoundingClientRect();
		if (menu === null || box === undefined) {
			setPlaced(null);
			return;
		}
		setPlaced({
			menu,
			x: Math.max(0, Math.min(menu.x, window.innerWidth - box.width)),
			y: Math.max(0, Math.min(menu.y, window.innerHeight - box.height)),
		});
		root.current?.querySelector("button")?.focus();
	}, [menu]);
	useEffect(() => {
		if (menu === null) {
			return;
		}
		const close = () => setMenu(null);
		const onPointer = (event: PointerEvent) => {
			if (!root.current?.contains(event.target as Node)) {
				close();
			}
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			event.preventDefault();
			close();
			menu.opener.focus();
		};
		document.addEventListener("pointerdown", onPointer, true);
		document.addEventListener("keydown", onKey);
		window.addEventListener("scroll", close, true);
		window.addEventListener("wheel", close, true);
		window.addEventListener("resize", close);
		return () => {
			document.removeEventListener("pointerdown", onPointer, true);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("scroll", close, true);
			window.removeEventListener("wheel", close, true);
			window.removeEventListener("resize", close);
		};
	}, [menu]);
	return (
		<OpenMenuContext value={setMenu}>
			{children}
			{menu === null ? null : (
				<div
					ref={root}
					role="menu"
					data-context-menu=""
					{...stylex.props(
						frame.menuList,
						styles.menu,
						placed?.menu === menu
							? styles.at(placed.x, placed.y)
							: styles.at(menu.x, menu.y),
					)}
				>
					{menu.items.map((item) => (
						<button
							key={item.label}
							type="button"
							role="menuitem"
							className={clsx(frame.menuItem, control.clear, control.focus)}
							onClick={() => {
								setMenu(null);
								item.run();
							}}
						>
							{item.label}
						</button>
					))}
				</div>
			)}
		</OpenMenuContext>
	);
}

/**
 * The props that open a context menu of these items at the pointer. With no
 * items, or outside a host, the browser shows its own menu.
 */
export function useContextMenu(items: readonly MenuItem[]) {
	const open = useContext(OpenMenuContext);
	if (open === null || items.length === 0) {
		return {};
	}
	return {
		onContextMenu: (event: MouseEvent<HTMLElement>) => {
			event.preventDefault();
			event.stopPropagation();
			open({
				x: event.clientX,
				y: event.clientY,
				items,
				opener: event.currentTarget,
			});
		},
	};
}

/**
 * The context menu props of a ticket card. `otherProject` names the project
 * of a ticket from another tracked project; the menu then opens its page.
 */
export function useTicketMenu(otherProject: string | undefined) {
	return useContextMenu(
		otherProject === undefined
			? []
			: [{ label: openProjectLabel, run: () => openProject(otherProject) }],
	);
}
