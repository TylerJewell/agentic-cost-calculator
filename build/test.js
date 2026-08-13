#!/usr/bin/env node
/*
  Runs the generated page's own compute() and asserts the figures it produces.

    node build/test.js

  These are golden values, not derivations. If a change moves one, it is either
  intended — update the expectation in the same commit and say why — or a
  regression. Silent movement is what this file exists to prevent.
*/
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

let VOL = 5000, SRCK = "aws", PROVK = "aws";
const stub = {
  value: 0, textContent: "", innerHTML: "", className: "", disabled: false,
  classList: { toggle() {}, add() {}, remove() {} }, dataset: {}, style: {},
  addEventListener() {}, querySelector() { return stub; }, querySelectorAll() { return []; },
};
global.document = {
  getElementById(id) {
    if (id === "vol")  return { ...stub, get value() { return VOL; } };
    if (id === "src")  return { ...stub, get value() { return SRCK; } };
    if (id === "prov") return { ...stub, get value() { return PROVK; } };
    return stub;
  },
  querySelector() { return stub; }, querySelectorAll() { return []; }, addEventListener() {},
};
global.window = { addEventListener() {}, scrollTo() {}, location: { hash: "" } };
global.history = { replaceState() {} };
global.location = { hash: "" };

const M = new Function(src + "\n;return{compute,marginAt,cpuStorageFor};")();

let pass = 0, fail = 0;
const money = (n) => "$" + (n / 1e6).toFixed(2) + "M";

function at(vol, prov, gpu) { VOL = vol; PROVK = prov; SRCK = gpu; return M.compute(); }

function eq(label, got, want, tol = 0) {
  const ok = tol ? Math.abs(got - want) <= tol : got === want;
  if (ok) { pass++; }
  else { fail++; console.error(`  FAIL  ${label}\n        got ${got}\n        want ${want}`); }
}
function near(label, got, want) { eq(label, Math.round(got), Math.round(want), Math.max(500, want * 0.005)); }

// ---- the anchor everything else was built around ----
{
  const d = at(5000, "aws", "aws");
  eq("5T AWS: nodes", d.nodes, 3);
  near("5T AWS: cost", d.cost, 836_064);
  near("5T AWS: price", d.price, 1_672_128);
  eq("5T AWS: margin is exactly 50%", Math.round((1 - d.cost / d.price) * 1000) / 1000, 0.5);
  near("5T AWS: compute and storage", d.cpu, 100_000);
  near("5T AWS: High total", d.aws.high.total, 8_089_000);
  eq("5T AWS: High accuracy matches Akka's tier", d.prov.acc.high, 80);
}

// ---- compute and storage must not move with the GPU source or the cloud ----
{
  const base = at(5000, "aws", "aws").cpu;
  for (const p of ["aws", "azure", "gcp"])
    for (const g of ["aws", "nebiusc", "lambdalow"])
      eq(`compute+storage is ${money(base)} on ${p}/${g}`, Math.round(at(5000, p, g).cpu), Math.round(base));
}

// ---- the margin curve hits both anchors ----
eq("margin at 5T is the cap", M.marginAt(5000), 0.5);
eq("margin at 1000T is the floor", M.marginAt(1_000_000), 0.188);
eq("margin below 5T stays capped", M.marginAt(1000), 0.5);

// ---- the schedule ----
near("compute+storage at 5T", M.cpuStorageFor(5000), 100_000);
near("compute+storage at 1T is the minimum", M.cpuStorageFor(1000), 50_000);
near("compute+storage at 1000T", M.cpuStorageFor(1_000_000), 3_566_667);

// ---- hardware selects itself, and the crossover sits where it should ----
{
  eq("10T stays on H100", at(10_000, "aws", "aws").hw.node, "p5.48xlarge");
  eq("50T moves to B200", at(50_000, "aws", "aws").hw.node, "p6-b200.48xlarge");
}

// ---- Luna is the High and Max tier on AWS and Azure, not on Google ----
{
  eq("AWS Max accuracy", at(5000, "aws", "aws").prov.acc.max, 88);
  eq("Azure Max accuracy", at(5000, "azure", "aws").prov.acc.max, 88);
  eq("Google has no Luna, so Max stays lower", at(5000, "gcp", "aws").prov.acc.max, 81);
  const g = at(5000, "gcp", "aws");
  eq("Google still pays the best-of-three multiplier", g.prov.maxMult, 3.35);
}

// ---- below the quoting minimum ----
{
  const d = at(900, "aws", "aws");
  eq("900B is below the minimum", d.below, true);
}

// ---- the in-VPC sources are the selected provider's own capacity ----
{
  eq("Azure reserved is labelled Azure", at(5000, "azure", "aws").src.label, "Azure reserved capacity");
  eq("Azure reserved H100", at(5000, "azure", "aws").src.h100, 59.0);
  eq("Azure on-demand is labelled Azure", at(5000, "azure", "awsod").src.label, "Azure on-demand");
  eq("Azure on-demand H100", at(5000, "azure", "awsod").src.h100, 98.32);
  eq("Google on-demand is labelled Google", at(5000, "gcp", "awsod").src.label, "Google on-demand");
  eq("Google on-demand H100", at(5000, "gcp", "awsod").src.h100, 88.49);
  eq("AWS on-demand survives the round trip", at(5000, "aws", "awsod").src.h100, 55.04);
  eq("A neocloud ignores the provider", at(5000, "gcp", "nebiusc").src.label, "Nebius, committed");
}

// ---- the neocloud makes the cloud irrelevant to Akka's price ----
{
  const p = ["aws", "azure", "gcp"].map((x) => Math.round(at(5000, x, "nebiusc").price));
  eq("Akka on Nebius costs the same on every cloud", new Set(p).size, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
