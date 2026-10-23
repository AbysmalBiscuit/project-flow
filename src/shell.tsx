import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { Button } from "./button.tsx";
import type { Configuration } from "./configuration.ts";
import { openJumpBox } from "./jump.tsx";
import { pageQuery, pageQueryClient, useSaveSettings } from "./queries.ts";
import { Segment } from "./segment.tsx";
import { navLabel } from "./terms.ts";
import { applyPageTheme, pageTheme } from "./theme.ts";
import { phoneGutter, projectBarLayout } from "./tokens.stylex.ts";
import { clsx } from "./ui.ts";
import { frame, headerControlStyle, shell } from "./ui-styles.ts";

export type PageView = {
	id: string;
	label: string;
};

export type PageHeaderProps = {
	title: string;
	subtitle?: ReactNode;
	filter?: ReactNode;
	sort?: ReactNode;
	search?: ReactNode;
	views?: readonly PageView[];
	view?: string;
	onView?: (id: string) => void;
	actions?: ReactNode;
};

function Glyph({ children }: { children: ReactNode }) {
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
			strokeWidth="2.25"
			strokeLinecap="round"
		>
			<path d="M6.25 8c0 5 5.75 4 5.75 8M17.75 8c0 5-5.75 4-5.75 8" />
			<rect
				x="1.5"
				y="2.5"
				width="9.5"
				height="6.5"
				rx="2"
				stroke="none"
				className={clsx(frame.markProgress)}
			/>
			<rect
				x="13"
				y="2.5"
				width="9.5"
				height="6.5"
				rx="2"
				stroke="none"
				className={clsx(frame.markReview)}
			/>
			<rect
				x="7.25"
				y="15"
				width="9.5"
				height="6.5"
				rx="2"
				stroke="none"
				className={clsx(frame.markMerge)}
			/>
		</svg>
	);
}

export function RefreshGlyph({ spinning = false }: { spinning?: boolean }) {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={clsx(frame.glyph, spinning && frame.spinning)}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M20 12a8 8 0 1 1-2.3-5.6" />
			<path d="M20 4v5h-5" />
		</svg>
	);
}

export function PollStatus({
	text,
	polling,
}: {
	text: string | null;
	polling: boolean;
}) {
	if (polling) {
		return (
			<span id="poll-status" role="status" aria-busy="true">
				<RefreshGlyph spinning />
				<span className={clsx(frame.visuallyHidden)}>
					{navLabel.refreshing}
				</span>
			</span>
		);
	}
	if (text === null || text === "") {
		return null;
	}
	return <span id="poll-status">{text}</span>;
}

function SettingsIcon() {
	return (
		<Glyph>
			<path d="M10.2 3.4h3.6l.5 2.1 1.8.8 1.6-1.5 2.5 2.5-1.5 1.6.8 1.8 2.1.5v3.6l-2.1.5-.8 1.8 1.5 1.6-2.5 2.5-1.6-1.5-1.8.8-.5 2.1h-3.6l-.5-2.1-1.8-.8-1.6 1.5-2.5-2.5 1.5-1.6-.8-1.8-2.1-.5v-3.6l2.1-.5.8-1.8-1.5-1.6 2.5-2.5 1.6 1.5 1.8-.8z" />
			<circle cx="12" cy="12" r="2.6" />
		</Glyph>
	);
}

function MoonIcon() {
	return (
		<Glyph>
			<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5z" />
		</Glyph>
	);
}

function SunIcon() {
	return (
		<Glyph>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2.5v2.5M12 19v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12h2.5M19 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
		</Glyph>
	);
}

const links = [
	{ href: "/", label: navLabel.overview },
	{ href: "/needs-you", label: navLabel.needsYou, count: true },
	{ href: "/inbox", label: navLabel.inbox },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
	const needs = useQuery(pageQuery.needsYou);
	const count = needs.data === undefined ? null : needs.data.length;
	const [theme, setTheme] = useState(pageTheme);
	const themeRef = useRef(theme);
	themeRef.current = theme;
	const [themeSaveFailed, setThemeSaveFailed] = useState(false);
	const save = useSaveSettings({ refetchProjects: false, optimistic: true });
	const saveTheme = (next: "light" | "dark") => {
		const patch = (current: Configuration) => ({ ...current, theme: next });
		void save.mutateAsync(patch).then(
			() => {
				if (next === themeRef.current) {
					setThemeSaveFailed(false);
				}
			},
			() => {
				if (next === themeRef.current) {
					setThemeSaveFailed(true);
				}
				void pageQueryClient.invalidateQueries(pageQuery.settings);
			},
		);
	};
	const path = window.location.pathname;
	const current = (href: string) =>
		href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
	const projectPage = path.startsWith("/projects/");
	return (
		<div className={clsx(frame.shell)}>
			<header
				className={clsx(
					frame.bar,
					phoneGutter.bar,
					projectPage && projectBarLayout.fit,
				)}
			>
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
							{"count" in link && count !== null && count > 0 ? (
								<span className={clsx(frame.count)}>{count}</span>
							) : null}
						</a>
					))}
				</nav>
				<span className={clsx(frame.spacer)} />
				<Button
					id="header-search"
					icon="search"
					label="Search tickets"
					onClick={() => openJumpBox()}
				/>
				<a
					className={clsx(frame.icon, shell.linkFocus)}
					href="/settings"
					aria-label={navLabel.settings}
					title={navLabel.settings}
				>
					<SettingsIcon />
				</a>
				<button
					type="button"
					className={clsx(frame.icon, shell.buttonFocus)}
					data-theme-toggle=""
					aria-label={navLabel.theme}
					title={theme === "dark" ? navLabel.light : navLabel.dark}
					onClick={() => {
						const next = themeRef.current === "dark" ? "light" : "dark";
						themeRef.current = next;
						applyPageTheme(next);
						setTheme(next);
						saveTheme(next);
					}}
				>
					{theme === "dark" ? <SunIcon /> : <MoonIcon />}
				</button>
			</header>
			{themeSaveFailed ? (
				<p className={clsx(frame.themeSave, phoneGutter.page)} role="alert">
					Theme not saved. This choice will not survive a reload.
				</p>
			) : null}
			{children}
		</div>
	);
}

export function PageHeader({
	title,
	subtitle,
	filter,
	sort,
	search,
	views,
	view,
	onView,
	actions,
}: PageHeaderProps) {
	const showTools =
		filter !== undefined ||
		sort !== undefined ||
		search !== undefined ||
		actions !== undefined ||
		(views !== undefined && views.length > 0);
	return (
		<div className={clsx(frame.row, views !== undefined && frame.rowTall)}>
			<div className={clsx(frame.heading)}>
				<h1 className={clsx(frame.title)}>{title}</h1>
				{subtitle === undefined ? null : (
					<p className={clsx(frame.subtitle)}>{subtitle}</p>
				)}
			</div>
			{showTools ? (
				<div className={clsx(frame.tools)}>
					{filter}
					{sort}
					{search}
					{views === undefined || views.length === 0 ? null : (
						<fieldset className={clsx(headerControlStyle.group)}>
							<legend className={clsx(frame.visuallyHidden)}>Views</legend>
							{views.map((item) => (
								<Segment
									key={item.id}
									id={`view-${item.id}`}
									label={item.label}
									on={view === item.id}
									onClick={() => onView?.(item.id)}
								/>
							))}
						</fieldset>
					)}
					{actions}
				</div>
			) : null}
		</div>
	);
}

export function PageFrame({
	children,
	wide = false,
	scroll = false,
	...header
}: PageHeaderProps & {
	children: ReactNode;
	wide?: boolean;
	scroll?: boolean;
}) {
	return (
		<AppShell>
			<main
				className={clsx(
					frame.page,
					phoneGutter.page,
					wide && frame.wide,
					(wide || scroll) && frame.fill,
				)}
			>
				<PageHeader {...header} />
				{scroll ? (
					<div className={clsx(frame.scroll)}>{children}</div>
				) : (
					children
				)}
			</main>
		</AppShell>
	);
}
