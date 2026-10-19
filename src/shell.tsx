import type { ReactNode } from "react";
import { useEffect, useState } from "react";
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

const links = [
	{ href: "/", label: navLabel.overview },
	{ href: "/needs-you", label: navLabel.needsYou, count: true },
	{ href: "/inbox", label: navLabel.inbox },
] as const;

function openCount(body: unknown): number {
	return Array.isArray(body) ? body.length : 0;
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
		return () => {
			stopped = true;
		};
	}, []);
	const current = (href: string) =>
		href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
	return (
		<>
			<header className={clsx(frame.bar)}>
				<a className={clsx(frame.logo, shell.linkFocus)} href="/">
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
					className={clsx(frame.icon, shell.buttonFocus)}
					data-theme-toggle=""
					aria-label={navLabel.theme}
					title={theme === "dark" ? navLabel.light : navLabel.dark}
					onClick={() => {
						const next = theme === "dark" ? "light" : "dark";
						applyPageTheme(next);
						setTheme(next);
						try {
							localStorage.setItem("project-flow-theme", next);
						} catch {
							// A private window can throw. The chosen theme still shows this visit.
						}
					}}
				>
					{theme === "dark" ? "☀" : "☾"}
				</button>
				<a
					className={clsx(
						frame.icon,
						shell.linkFocus,
						path === "/settings" && frame.current,
					)}
					href="/settings"
					aria-label={navLabel.settings}
					aria-current={path === "/settings" ? "page" : undefined}
					title={navLabel.settings}
				>
					⚙
				</a>
			</header>
			{children}
		</>
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
	...header
}: PageHeaderProps & { children: ReactNode }) {
	return (
		<AppShell>
			<main className={clsx(frame.page)}>
				<PageHeader {...header} />
				{children}
			</main>
		</AppShell>
	);
}
