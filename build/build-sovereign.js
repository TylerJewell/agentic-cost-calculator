#!/usr/bin/env node
/*
  Generates sovereign.html from build/sovereign-template.html + audit/rates.json.

  Same standalone-page shape as build.js: every figure baked in as literals, no
  runtime fetch. Regenerate on rate changes:

    node build/build-sovereign.js

  The sovereign calculator answers a different question from index.html — not
  "what does an AI workload cost on cloud vs Akka" but "what does a well-optimized
  routing + SLM stack save relative to paying frontier rates for everything?"
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RATES = path.join(ROOT, "audit", "rates.json");
const TEMPLATE = path.join(__dirname, "sovereign-template.html");
const OUT = path.join(ROOT, "sovereign.html");
const MARKER = "/*__MODEL__*/";

const rates = JSON.parse(fs.readFileSync(RATES, "utf8"));
const r = rates.runtime;
if (!r) fail("rates.json has no `runtime` block");
const a = r.akka;
const j = (v) => JSON.stringify(v);

// ---- model catalog: frontier (top dropdown) and mid-tier (right-side checkbox) ----
// A first-party direct-API model with per-token pricing is a candidate; classification
// is by dense-equivalent active parameters as recorded in the build.js BE_BASE map.
// Frontier: 40B+ active params (closest open-weight class Kimi K3 / DeepSeek V4-Pro).
// Mid-tier and below: everything smaller.
const FRONTIER_KEYS = new Set([
  "claude-fable-5", "claude-opus-5",
  "gpt-5.6-sol", "gpt-5.6-terra",
  "deepseek-v4-pro",
]);
const MIDTIER_KEYS = new Set([
  "claude-sonnet-5", "claude-haiku-4-5",
  "gpt-5.6-luna",
  "deepseek-v4-flash",
]);
const PROVIDER_LABELS = {
  anthropic_direct: "Anthropic",
  openai_direct: "OpenAI",
  deepseek_direct: "DeepSeek",
};
const PROVIDER_ORDER = ["anthropic_direct", "openai_direct", "deepseek_direct"];

function collectModels(keySet) {
  const out = [];
  for (const p of PROVIDER_ORDER) {
    const block = rates.inference[p];
    if (!block || !block.models) continue;
    for (const [m, v] of Object.entries(block.models)) {
      if (!keySet.has(m)) continue;
      if (v.in === undefined || v.out === undefined) continue;
      out.push({ p: PROVIDER_LABELS[p], m, in: v.in, out: v.out });
    }
  }
  return out;
}

const FRONTIER = collectModels(FRONTIER_KEYS);
const MIDTIER = collectModels(MIDTIER_KEYS);
if (!FRONTIER.length) fail("no frontier models resolved from rates.json");
if (!MIDTIER.length) fail("no mid-tier models resolved from rates.json");

// ---- Akka self-hosted effective per-million-token rates ----
// The main calc computes an Akka cost from the GPU fleet + margin. For the
// sovereign calc we need a per-million-token rate the router can apply as a
// destination rate. We derive it from the runtime block: the effective serving
// throughput divided into the fleet cost, then apply the base margin.
// This is an approximation; the audit panel cites its assumptions.
const AKKA_INPUT_PER_M  = a.akkaInputRatePerM  || 0.09;
const AKKA_OUTPUT_PER_M = a.akkaOutputRatePerM || 0.62;
// If these aren't in rates.json yet, the defaults above are the GCP-derived
// figures from the reference-methodology paragraph in the main calc; a future
// rates.json refresh should land canonical values here.

// ---- prompt cache multiplier (right-side #3), batch multiplier (right-side #4) ----
const PROMPT_CACHE_MULT = rates.inference.prompt_cache
  ? rates.inference.prompt_cache.effective_input_multiple
  : 0.1;
// API batch pricing on Anthropic and OpenAI is 50% of standard token rates when
// the caller accepts up to a 24-hour turnaround. This is distinct from
// r.akka.batchMultiple in the main calc (a serving-throughput uplift on idle
// capacity), so this constant is deliberately named API_BATCH_MULT rather than
// BATCH_MULT to prevent silent semantic collision.
const API_BATCH_MULT = 0.5;

// Adapter compression parameters — the sovereign SLM lever uses inputRetained,
// outputRetained AND computeMultiple. Sourced from rates.json so both this
// calculator and the main calc's ADAPT constant share the same numbers.
const ADAPT = r.akka.adapter;

// ---- Full model catalog: API + self-hosted, spanning 5 classes ----
// API models come straight from rates.json. Self-hosted models are synthetic:
// the rate is a size-class scaling of AKKA_IN/AKKA_OUT (the reference GCP B200
// per-M rate from the main calc's methodology). A future rates.json refresh
// should carry canonical per-model-class per-M rates rather than these scalars.
const CATALOG = [
  // API frontier — highest published proprietary tiers
  ...FRONTIER.map(m => ({key:m.p+":"+m.m, name:m.p+" "+m.m, cls:"frontier",
                          clsLabel:"API frontier", api:true, in:m.in, out:m.out})),
  // API mid-tier
  ...MIDTIER.map(m => ({key:m.p+":"+m.m, name:m.p+" "+m.m, cls:"mid",
                        clsLabel:"API mid-tier", api:true, in:m.in, out:m.out})),
  // Self-hosted small
  {key:"sh:qwen3-coder-next", name:"Qwen3 Coder Next 3B", cls:"small",
    clsLabel:"Self-hosted small (3–10B)", api:false,
    in:AKKA_INPUT_PER_M*0.5, out:AKKA_OUTPUT_PER_M*0.5},
  {key:"sh:ministral-8b", name:"Ministral 8B", cls:"small",
    clsLabel:"Self-hosted small (3–10B)", api:false,
    in:AKKA_INPUT_PER_M*0.5, out:AKKA_OUTPUT_PER_M*0.5},
  // Self-hosted mid
  {key:"sh:kimi-k2-6", name:"Kimi K2.6 32B", cls:"mid_sh",
    clsLabel:"Self-hosted mid (30–50B)", api:false,
    in:AKKA_INPUT_PER_M, out:AKKA_OUTPUT_PER_M},
  {key:"sh:deepseek-v4-pro", name:"DeepSeek V4-Pro 49B (self-hosted)", cls:"mid_sh",
    clsLabel:"Self-hosted mid (30–50B)", api:false,
    in:AKKA_INPUT_PER_M, out:AKKA_OUTPUT_PER_M},
  // Self-hosted large
  {key:"sh:kimi-k3", name:"Kimi K3 104B", cls:"large_sh",
    clsLabel:"Self-hosted large (100B+)", api:false,
    in:AKKA_INPUT_PER_M*2.0, out:AKKA_OUTPUT_PER_M*2.0},
  {key:"sh:qwen3-vl-235b", name:"Qwen3 VL 235B", cls:"large_sh",
    clsLabel:"Self-hosted large (100B+)", api:false,
    in:AKKA_INPUT_PER_M*2.0, out:AKKA_OUTPUT_PER_M*2.0},
];

// GPU sources: hourly rates per GPU by (cloud VPC reserved / cloud VPC on-demand)
// and by neocloud. `PROVIDERS` carries the customer's chosen-cloud rates so we
// can show only the picked cloud's in-VPC options in the second dropdown, while
// `NEOCLOUDS` is enumerated in full regardless of cloud choice.
const PROVIDERS = {};
for(const [k, v] of Object.entries(r.providers)){
  PROVIDERS[k] = {
    label: v.label || k.toUpperCase(),
    vpcH100: v.vpcH100, vpcB200: v.vpcB200,
    vpcOdH100: v.vpcOdH100, vpcOdB200: v.vpcOdB200
  };
}
const NEOCLOUDS = {};
for(const [k, v] of Object.entries(r.gpuSources)){
  if(v && v.vpc === false && typeof v.h100 === "number" && typeof v.b200 === "number"){
    NEOCLOUDS[k] = {label:v.label, h100:v.h100, b200:v.b200};
  }
}

const model = `// GENERATED from audit/rates.json by build/build-sovereign.js. Do not edit here.
// Baseline ${rates.baseline}. Regenerate with: node build/build-sovereign.js
const FRONTIER=${j(FRONTIER)};
const MIDTIER=${j(MIDTIER)};
const WORKLOADS=${j(r.workloads)};
const CATALOG=${j(CATALOG)};
const PROVIDERS=${j(PROVIDERS)};
const NEOCLOUDS=${j(NEOCLOUDS)};
const AKKA_IN=${AKKA_INPUT_PER_M};
const AKKA_OUT=${AKKA_OUTPUT_PER_M};
const ADAPT=${j(ADAPT)};
// Akka Platform annual fixed overhead: compute/storage first-block figure that
// covers everything included in the platform floor. Variable margin declines
// log-scale with volume from 50% at ≤5T to 18.8% at 1000T.
const PLATFORM_FIXED=${a.cpuStorage.first};
const MARGIN_HI=${a.margin.hi};
const MARGIN_LO=${a.margin.lo};
const MARGIN_V0=${a.margin.v0};
const MARGIN_V1=${a.margin.v1};
const CACHE_MULT=${PROMPT_CACHE_MULT};
const API_BATCH_MULT=${API_BATCH_MULT};
const PRESETS=${j(r.presets)};
const IN_RATIO=0.85;
const MAX_SELECTED=6;
// Volume-commit tiers, published enterprise schedules (verify before ship).
const COMMIT_TIERS=[
  {label:"No commit", pct:0},
  {label:"$50k/yr",   pct:0.05},
  {label:"$250k/yr",  pct:0.10},
  {label:"$1M/yr",    pct:0.15},
  {label:"$5M/yr",    pct:0.22}
];`;

// ---- inject ----
const tpl = fs.readFileSync(TEMPLATE, "utf8");
if (!tpl.includes(MARKER)) fail(`sovereign-template.html has no ${MARKER} marker`);
const out = tpl.replace(MARKER, model);
for (const pattern of [/fetch\s*\(/, /XMLHttpRequest/, /<script[^>]+src=["'](?!https:)/]) {
  if (pattern.test(out)) fail(`generated page loads something at runtime (${pattern})`);
}
fs.writeFileSync(OUT, out);

console.log(`built sovereign.html  (${(out.length / 1024).toFixed(1)} KB)`);
console.log(`  ${FRONTIER.length} frontier models, ${MIDTIER.length} mid-tier`);

function fail(m) { console.error("BUILD FAILED: " + m); process.exit(1); }
