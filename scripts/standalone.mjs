import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
let html = await readFile(path.join(dist, "index.html"), "utf8");
const script = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/);
const style = html.match(
  /<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/,
);
if (!script || !style) throw new Error("Vite entry assets not found");
const js = await readFile(
  path.join(dist, script[1].replace(/^\//, "")),
  "utf8",
);
let css = await readFile(path.join(dist, style[1].replace(/^\//, "")), "utf8");
const artwork = new Map();
for (const name of ["courtyard.png", "portraits.png", "card-frame.png"]) {
  const art = await readFile(path.join(dist, "art", name));
  artwork.set(name, "data:image/png;base64," + art.toString("base64"));
}
css = css.replace(/url\((["']?)([^)"']+)\1\)/g, (match, _quote, url) => {
  const name = url.split("/").at(-1);
  return artwork.has(name) ? `url("${artwork.get(name)}")` : match;
});
const icon = await readFile(path.join(dist, "sigil.svg"));
html = html.replace(
  script[0],
  () =>
    '<script type="module">' +
    js.replace(/<\/script/gi, "<\\/script") +
    "</script>",
);
html = html.replace(style[0], () => "<style>" + css + "</style>");
html = html.replace(
  /href="\.\/sigil\.svg"/,
  'href="data:image/svg+xml;base64,' + icon.toString("base64") + '"',
);
await writeFile(path.join(dist, "standalone.html"), html);
await writeFile(path.join(root, "灰烬契约.html"), html);
console.log(
  "Offline game: 灰烬契约.html (" +
    (Buffer.byteLength(html) / 1024 / 1024).toFixed(1) +
    " MiB)",
);
