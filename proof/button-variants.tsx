import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, type IconName } from "../src/button.tsx";

const icons: IconName[] = ["external-link", "expand", "shrink", "x"];
const noop = () => {};

const rows = [
	{
		name: "label only",
		items: [
			<Button key="a" label="GitHub" onClick={noop} />,
			<Button key="b" label="Linear" href="#" />,
		],
	},
	{
		name: "icon only",
		items: icons.map((icon) => (
			<Button key={icon} icon={icon} name={icon} onClick={noop} />
		)),
	},
	{
		name: "icon left",
		items: icons.map((icon) => (
			<Button key={icon} icon={icon} label={icon} onClick={noop} />
		)),
	},
	{
		name: "icon right",
		items: icons.map((icon) => (
			<Button key={icon} icon={icon} label={icon} iconSide="right" href="#" />
		)),
	},
];

function Heights() {
	const [text, setText] = useState("heights waiting");
	useEffect(() => {
		const heights = [
			...document.querySelectorAll("[data-variants] a, [data-variants] button"),
		].map((node) => node.getBoundingClientRect().height);
		const first = heights[0];
		const equal = heights.every((height) => height === first);
		setText(
			`${heights.length} buttons, heights ${equal ? `all equal ${first}px` : `differ ${heights.join(" ")}`}`,
		);
	}, []);
	return <p id="variant-heights">{text}</p>;
}

function Variants() {
	return (
		<main
			style={{
				padding: 24,
				display: "grid",
				gap: 16,
				fontFamily: '"Geist Sans", "Geist", sans-serif',
			}}
		>
			<h1>Button variants</h1>
			<div data-variants style={{ display: "grid", gap: 12 }}>
				{rows.map((row) => (
					<div
						key={row.name}
						style={{ display: "flex", gap: 8, alignItems: "center" }}
					>
						<span style={{ width: 96 }}>{row.name}</span>
						{row.items}
					</div>
				))}
			</div>
			<Heights />
		</main>
	);
}

const root = document.getElementById("root");
if (root !== null) {
	createRoot(root).render(<Variants />);
}
