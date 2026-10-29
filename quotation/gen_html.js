const fs = require("fs");
const [src, out] = process.argv.slice(2);
const mods = JSON.parse(fs.readFileSync(__dirname + "/modules.json", "utf8"));
const esc = s => s.replace(/&/g, "&amp;");
const box = ([t, items]) => `    <div class="box"><h3>${esc(t)}</h3><ul>\n${items.map(i => `      <li>${esc(i)}</li>`).join("\n")}\n    </ul></div>`;
const groups = [mods.slice(0, 6), mods.slice(6), []];
let n = 0;
let html = fs.readFileSync(src, "utf8").replace(/  <div class="grid"([^>]*)>[\s\S]*?\n  <\/div>\n/g, (m, attrs) => {
  const g = groups[n++];
  return g.length ? `  <div class="grid"${attrs}>\n${g.map(box).join("\n")}\n  </div>\n` : "";
});
html = html.replace('<h2 style="margin-top:8mm">Commercial Terms</h2>', '<h2 style="margin-top:7mm">Commercial Terms</h2>');
fs.writeFileSync(out, html);
console.log("grids replaced:", n);
