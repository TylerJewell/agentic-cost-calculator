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
];

for (const [from, to] of patches) {
  const n = html.split(from).length - 1;
  if (n !== 1) fail("expected 1 match, found " + n + ": " + from.trim().slice(0, 60));
  html = html.replace(from, to);
}

fs.writeFileSync(OUT, html);
console.log("wrote " + path.relative(ROOT, OUT) + " — " + patches.length + " patches applied");

function fail(msg) { console.error("build-physical: " + msg); process.exit(1); }
