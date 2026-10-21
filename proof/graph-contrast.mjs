var channel = (value) => {
	var linear = value / 255;
	return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
};
var parts = (colour) => {
	var found = colour.match(/\d+(?:\.\d+)?/g);
	return found ? found.slice(0, 3).map(Number) : [];
};
var luminance = (colour) => {
	var rgb = parts(colour);
	if (rgb.length < 3) {
		return 0;
	}
	return (
		0.2126 * channel(rgb[0]) +
		0.7152 * channel(rgb[1]) +
		0.0722 * channel(rgb[2])
	);
};
var ratioOf = (foreground, background) => {
	var lighter = Math.max(luminance(foreground), luminance(background));
	var darker = Math.min(luminance(foreground), luminance(background));
	return (lighter + 0.05) / (darker + 0.05);
};
var pane = document.querySelector("#project-graph");
var canvas =
	pane instanceof HTMLElement ? getComputedStyle(pane).backgroundColor : "";
var legend = document.querySelector('[aria-label="Graph legend"]');
var notes = legend instanceof HTMLElement ? legend.querySelectorAll("p") : [];
var solidSwatch =
	notes[0] instanceof HTMLElement ? notes[0].querySelector("span") : null;
var doneSwatch =
	notes[1] instanceof HTMLElement ? notes[1].querySelector("span") : null;
var solid =
	solidSwatch instanceof HTMLElement
		? getComputedStyle(solidSwatch).backgroundColor
		: "";
var dashedImage =
	doneSwatch instanceof HTMLElement
		? getComputedStyle(doneSwatch).backgroundImage
		: "";
var markers = Array.from(
	document.querySelectorAll("marker.react-flow__arrowhead polyline"),
).map((node) => getComputedStyle(node).fill);
var matched = dashedImage.match(/rgba?\([^)]+\)/);
var dashed =
	markers.find((fill) => fill !== solid && fill !== "" && fill !== "none") ??
	(matched ? matched[0] : "");
var solidRatio = ratioOf(solid, canvas);
var dashedRatio = ratioOf(dashed, canvas);
var theme =
	document.documentElement.dataset.theme === "dark" ? "dark" : "light";
var line = [
	`theme ${theme}`,
	`canvas ${canvas}`,
	`solid ${solid} ${solidRatio.toFixed(2)}`,
	`dashed ${dashed} ${dashedRatio.toFixed(2)}`,
	`markers ${markers.join(" ")}`,
	`swatch ${dashedImage}`,
].join(" | ");
if (
	solid === "" ||
	dashed === "" ||
	solidRatio < 3 ||
	dashedRatio < 3 ||
	markers.indexOf(solid) === -1 ||
	markers.indexOf(dashed) === -1 ||
	(dashedImage.indexOf(dashed) === -1 &&
		dashedImage.indexOf(dashed.replace(/, /g, ",")) === -1)
) {
	throw new Error(line);
}
line;
