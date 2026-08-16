#!/usr/bin/env node
/*
  Generates physical.html from index.html.

    node build/build.js && node build/build-physical.js

  Same page, same layout, same wording. Two rows are dropped and two figures are
  computed differently, so that both columns show physical infrastructure only:
  the build-it-yourself total loses support and professional services, and the
  Akka figure loses margin.

  This patches the generated page rather than carrying its own copy of the model,
  so audit/rates.json remains the only place a rate is defined. Every patch below
  asserts it matched; if build.js output moves, this fails loudly rather than
  emitting a page that silently still contains the margin.
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "index.html");
const OUT = path.join(ROOT, "physical.html");

let html = fs.readFileSync(SRC, "utf8");

const patches = [
  // the build-it-yourself total becomes the infrastructure subtotal
  ["aws[k].total=cons+aws[k].sup+aws[k].svc;",
   "aws[k].total=cons;"],

  // the two lines that are not infrastructure
  ['  h+=line("Enterprise Support Plan",a=>a.sup,inc);\n  h+=line("Consultants",a=>a.svc,inc);\n',
   ""],

  // the Akka figure becomes its own cost
  ["const margin=marginAt(totalB), price=cost/(1-margin);",
   "const price=cost;"],
  ["upPrice=upCost/(1-margin);",
   "upPrice=upCost;"],

  // the first-year figure is now infrastructure alone, so it is annotated with what
  // sits on top of it. Right alignment is inherited from the cell.
  [".tag.no{color:var(--medium-grey);background:rgba(241,241,241,.03);border:1px solid var(--line);}",
   ".tag.no{color:var(--medium-grey);background:rgba(241,241,241,.03);border:1px solid var(--line);}\n" +
   "tr.tot td.akka .mrgn{display:block;font-family:var(--mono);font-size:8px;font-weight:400;\n" +
   "  line-height:1;letter-spacing:.2px;color:var(--soft-grey);margin-top:-1px;}"],
  ['\'<td class="n akka">\'+(d.below?"—":money(d.price))+"</td></tr>";',
   '\'<td class="n akka">\'+(d.below?"—":money(d.price)+\'<span class="mrgn">+ our margin</span>\')+"</td></tr>";'],
];

for (const [from, to] of patches) {
  const n = html.split(from).length - 1;
  if (n !== 1) fail("expected 1 match, found " + n + ": " + from.trim().slice(0, 60));
  html = html.replace(from, to);
}

fs.writeFileSync(OUT, html);
console.log("wrote " + path.relative(ROOT, OUT) + " — " + patches.length + " patches applied");

function fail(msg) { console.error("build-physical: " + msg); process.exit(1); }
