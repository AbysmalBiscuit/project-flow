import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { onAppEvent } from "./events.ts";
import { openJumpBox } from "./jump.tsx";
import { navLabel } from "./terms.ts";
import { applyPageTheme, pageTheme } from "./theme.ts";
import { clsx } from "./ui.ts";
import { frame, shell } from "./ui-styles.ts";

export type PageView = {
	id: string;
	label: string;
};

export type PageHeaderProps = {
	title: string;
	filter?: ReactNode;
	sort?: ReactNode;
	search?: ReactNode;
	views?: readonly PageView[];
	view?: string;
	onView?: (id: string) => void;
};

function ThemeIcon({ children }: { children: ReactNode }) {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={clsx(frame.glyph)}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			{children}
		</svg>
	);
}

function LogoMark() {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={clsx(frame.glyph)}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="4" y="4" width="16" height="16" rx="3" />
			<path d="M8 12h8M12 8v8" />
		</svg>
	);
}

function MoonIcon() {
	return (
		<ThemeIcon>
			<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5z" />
		</ThemeIcon>
	);
}

function SunIcon() {
	return (
		<ThemeIcon>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2.5v2.5M12 19v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12h2.5M19 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
		</ThemeIcon>
	);
}

const links = [
	{ href: "/", label: navLabel.overview },
	{ href: "/needs-you", label: navLabel.needsYou, count: true },
	{ href: "/inbox", label: navLabel.inbox },
] as const;

function openCount(body: unknown): number {
	return Array.isArray(body) ? body.length : 0;
}

async function saveTheme(theme: "light" | "dark"): Promise<boolean> {
	try {
		const loaded = await fetch("/api/settings");
		if (!loaded.ok) {
			return false;
		}
		const current: unknown = await loaded.json();
		if (current === null || typeof current !== "object") {
			return false;
		}
		const saved = await fetch("/api/settings", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...current, theme }),
		});
		return saved.ok;
	} catch {
		return false;
	}
}

export function AppShell({ children }: { children: ReactNode }) {
	const [count, setCount] = useState<number | null>(null);
	const [theme, setTheme] = useState(pageTheme);
	const path = window.location.pathname;
	useEffect(() => {
		let stopped = false;
		const load = () => {
			fetch("/api/needs-you")
				.then(async (response) => {
					if (!stopped && response.ok) {
						setCount(openCount(await response.json()));
					}
				})
				.catch(() => {
					if (!stopped) {
						setCount(0);
					}
				});
		};
		load();
		const stop = onAppEvent("overview", () => {
			load();
		});
		return () => {
			stopped = true;
			stop();
		};
	}, []);
	const current = (href: string) =>
		href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
	return (
		<div className={clsx(frame.shell)}>
			<header className={clsx(frame.bar)}>
				<a className={clsx(frame.logo, shell.linkFocus)} href="/">
					<LogoMark />
					{navLabel.logo}
				</a>
				<nav className={clsx(frame.nav)} aria-label="App">
					{links.map((link) => (
						<a
							key={link.href}
							className={clsx(
								frame.item,
								shell.linkFocus,
								current(link.href) && frame.current,
							)}
							href={link.href}
							aria-current={current(link.href) ? "page" : undefined}
						>
							{link.label}
							{"count" in link && count !== null ? (
								<span className={clsx(frame.count)}>{count}</span>
							) : null}
						</a>
					))}
				</nav>
				<span className={clsx(frame.spacer)} />
				<button
					type="button"
					id="header-search"
					className={clsx(frame.query, shell.buttonFocus)}
					aria-label="Search tickets"
					title="Search tickets"
					onClick={() => openJumpBox()}
				>
					<span aria-hidden="true">⌕</span>
					Search tickets
				</button>
				<button
					type="button"
					className={clsx(frame.icon, shell.buttonFocus)}
					data-theme-toggle=""
					aria-label={navLabel.theme}
					title={theme === "dark" ? navLabel.light : navLabel.dark}
					onClick={() => {
						const next = theme === "dark" ? "light" : "dark";
						void saveTheme(next).then((saved) => {
							if (!saved) {
								return;
							}
							applyPageTheme(next);
							setTheme(next);
						});
					}}
				>
					{theme === "dark" ? <SunIcon /> : <MoonIcon />}
					<span className={clsx(frame.legend)}>
						{navLabel.theme} {theme}
					</span>
				</button>
				<a className={clsx(frame.legend)} href="/settings">
					{navLabel.settings}
				</a>
			</header>
			{children}
		</div>
	);
}

export function PageHeader({
	title,
	filter,
	sort,
	search,
	views,
	view,
	onView,
}: PageHeaderProps) {
	const showTools =
		filter !== undefined ||
		sort !== undefined ||
		search !== undefined ||
		(views !== undefined && views.length > 0);
	return (
		<div className={clsx(frame.row)}>
			<h1 className={clsx(frame.title)}>{title}</h1>
			{showTools ? (
				<div className={clsx(frame.tools)}>
					{filter}
					{sort}
					{search}
					{views === undefined || views.length === 0 ? null : (
						<fieldset className={clsx(frame.views)}>
							<legend className={clsx(frame.legend)}>Views</legend>
							{views.map((item) => (
								<button
									key={item.id}
									type="button"
									id={`view-${item.id}`}
									className={clsx(
										shell.button,
										shell.buttonHover,
										shell.buttonFocus,
										view === item.id && shell.pressed,
									)}
									aria-pressed={view === item.id}
									onClick={() => onView?.(item.id)}
								>
									{item.label}
								</button>
							))}
						</fieldset>
					)}
				</div>
			) : null}
		</div>
	);
}

export function PageFrame({
	children,
	wide = false,
	...header
}: PageHeaderProps & { children: ReactNode; wide?: boolean }) {
	return (
		<AppShell>
			<main className={clsx(frame.page, wide && frame.wide)}>
				<PageHeader {...header} />
				{children}
			</main>
		</AppShell>
	);
}
