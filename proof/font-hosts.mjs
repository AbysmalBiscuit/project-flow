const port = process.env.PORT ?? "4174";
const page = await fetch(`http://127.0.0.1:${port}/`);
const html = await page.text();
const cssPath = html.match(/href="(\/chunk-[^"]+\.css)"/)?.[1];
if (cssPath === undefined) {
	console.error("page has no stylesheet");
	process.exit(1);
}
const css = await (await fetch(`http://127.0.0.1:${port}${cssPath}`)).text();
const hosts = new Set(
	[...`${html}\n${css}`.matchAll(/https?:\/\/([^/"'\s)]+)/g)].map(
		(match) => match[1] ?? "",
	),
);
const thirdParty = [...hosts].filter((host) => host !== `127.0.0.1:${port}`);
console.log(`stylesheet ${cssPath}`);
console.log(`font-face ${css.includes("@font-face")}`);
console.log(`geist ${css.includes("Geist Sans")}`);
console.log(`hosts ${[...hosts].join(" ") || "none"}`);
if (thirdParty.length > 0) {
	console.error(`third-party hosts ${thirdParty.join(" ")}`);
	process.exit(1);
}
