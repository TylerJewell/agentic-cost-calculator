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
  "gemini-3-pro", "grok-5",
  "deepseek-v4-pro",
]);
const MIDTIER_KEYS = new Set([
  "claude-sonnet-5", "claude-haiku-4-5",
  "gpt-5.6-luna",
  "gemini-3-flash", "grok-5-fast",
  "deepseek-v4-flash",
]);
const PROVIDER_LABELS = {
  anthropic_direct: "Anthropic",
  openai_direct: "OpenAI",
  google_direct: "Google",
  xai_direct: "xAI",
  deepseek_direct: "DeepSeek",
};
const PROVIDER_ORDER = ["anthropic_direct", "openai_direct", "google_direct",
                        "xai_direct", "deepseek_direct"];

// Open weights served on someone else's API — the middle path between a
// proprietary endpoint and running the weights yourself. The same model is
// often listed on both clouds at different rates, so the cheaper of the two
// wins, compared on the page's own 85/15 input/output blend.
const OPENWEIGHT_KEYS = new Set([
  "ministral-3b", "phi-4", "llama-4-scout", "qwen3-next-80b",
  "mistral-large-3", "deepseek-v3.2", "deepseek-r1",
]);
const OPENWEIGHT_CLOUDS = { aws_bedrock: "Bedrock", azure_ai_foundry: "Foundry" };
const OPENWEIGHT_NAMES = {
  "ministral-3b": "Ministral 3B",
  "phi-4": "Phi-4",
  "llama-4-scout": "Llama 4 Scout",
  "qwen3-next-80b": "Qwen3 Next 80B",
  "mistral-large-3": "Mistral Large 3",
  "deepseek-v3.2": "DeepSeek V3.2",
  "deepseek-r1": "DeepSeek R1",
};

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

// Cheapest listing of each open-weight model across the cloud model gardens.
// Blend matches IN_RATIO in the page, so "cheaper" here means cheaper for the
// traffic shape the calculator actually prices.
const BLEND = (m) => m.in * 0.85 + m.out * 0.15;
function collectOpenWeight() {
  const best = new Map();
  for (const [provider, cloud] of Object.entries(OPENWEIGHT_CLOUDS)) {
    const block = rates.inference[provider];
    if (!block || !block.models) continue;
    for (const [m, v] of Object.entries(block.models)) {
      if (!OPENWEIGHT_KEYS.has(m)) continue;
      if (v.in === undefined || v.out === undefined) continue;
      const cand = { p: cloud, m, in: v.in, out: v.out };
      const held = best.get(m);
      if (!held || BLEND(cand) < BLEND(held)) best.set(m, cand);
    }
  }
  return [...OPENWEIGHT_KEYS].filter(k => best.has(k)).map(k => best.get(k));
}
const OPENWEIGHT = collectOpenWeight();
const missingOW = [...OPENWEIGHT_KEYS].filter(k => !OPENWEIGHT.some(m => m.m === k));
if (missingOW.length) fail(`open-weight keys absent from rates.json: ${missingOW.join(", ")}`);

// ---- Akka self-hosted effective per-million-token rates by size class ----
// Rates come from the main calc's methodology paragraph, calibrated against
// GCP reserved B200 at $16.11/GPU-hr (128.88/node-hr) with 40% endpoint
// utilisation and the modelled serving throughput. The three tiers use the
// same values the main calc's SLM Savings tab uses. hostMultiplier() then
// scales these rates by (chosen source / GCP reserved B200 reference), so
// picking AWS reserved B200 lowers them proportionally.
const AKKA_SMALL_IN  = 0.09,  AKKA_SMALL_OUT  = 0.62;
const AKKA_MID_IN    = 0.25,  AKKA_MID_OUT    = 2.39;
const AKKA_LARGE_IN  = 0.37,  AKKA_LARGE_OUT  = 4.14;
// The three bands above leave 10-30B and 50-100B unpriced, and several of the
// most commonly self-hosted models sit in exactly those gaps. Both fills are
// interpolated along the curve the three reference points already describe
// rather than picked: per-token cost against active parameters is a power law
// whose exponent is read off the neighbouring pair, and the band's midpoint is
// evaluated on it. Reference points are 6B small, 40B mid, 150B large.
//   compact  18B: 0.09*(18/6)^0.539 = 0.16   0.62*(18/6)^0.711 = 1.35
//   uppermid 70B: 0.25*(70/40)^0.296 = 0.29  2.39*(70/40)^0.415 = 3.00
const AKKA_COMPACT_IN = 0.16, AKKA_COMPACT_OUT = 1.35;
const AKKA_UMID_IN    = 0.29, AKKA_UMID_OUT    = 3.00;
// AKKA_IN/AKKA_OUT retained as backwards-compat aliases (small tier).
const AKKA_INPUT_PER_M  = AKKA_SMALL_IN;
const AKKA_OUTPUT_PER_M = AKKA_SMALL_OUT;

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
  // API open-weight — open weights on a cloud model garden, cheapest listing
  ...OPENWEIGHT.map(m => ({key:m.p+":"+m.m, name:OPENWEIGHT_NAMES[m.m]+" ("+m.p+")",
                           cls:"ow", clsLabel:"API open-weight", api:true,
                           in:m.in, out:m.out})),
  // Self-hosted bands are keyed on ACTIVE parameters, so a sparse MoE lands far
  // below its total size: Qwen3 Next is 80B total but routes 3B per token, and
  // DeepSeek V3.2 is 671B total against 37B active.
  // Self-hosted small (3–10B active params)
  {key:"sh:qwen3-coder-next", name:"Qwen3 Coder Next 3B", cls:"small",
    clsLabel:"Self-hosted small (3–10B)", api:false,
    in:AKKA_SMALL_IN, out:AKKA_SMALL_OUT},
  {key:"sh:ministral-8b", name:"Ministral 8B", cls:"small",
    clsLabel:"Self-hosted small (3–10B)", api:false,
    in:AKKA_SMALL_IN, out:AKKA_SMALL_OUT},
  {key:"sh:ministral-3b", name:"Ministral 3B", cls:"small",
    clsLabel:"Self-hosted small (3–10B)", api:false,
    in:AKKA_SMALL_IN, out:AKKA_SMALL_OUT},
  {key:"sh:qwen3-next-80b", name:"Qwen3 Next 80B (3B active)", cls:"small",
    clsLabel:"Self-hosted small (3–10B)", api:false,
    in:AKKA_SMALL_IN, out:AKKA_SMALL_OUT},
  // Self-hosted compact (10–30B active params)
  {key:"sh:phi-4", name:"Phi-4 14B", cls:"compact_sh",
    clsLabel:"Self-hosted compact (10–30B)", api:false,
    in:AKKA_COMPACT_IN, out:AKKA_COMPACT_OUT},
  {key:"sh:llama-4-scout", name:"Llama 4 Scout (17B active)", cls:"compact_sh",
    clsLabel:"Self-hosted compact (10–30B)", api:false,
    in:AKKA_COMPACT_IN, out:AKKA_COMPACT_OUT},
  {key:"sh:mistral-small-3-2", name:"Mistral Small 3.2 24B", cls:"compact_sh",
    clsLabel:"Self-hosted compact (10–30B)", api:false,
    in:AKKA_COMPACT_IN, out:AKKA_COMPACT_OUT},
  // Self-hosted mid (30–50B active params)
  {key:"sh:kimi-k2-6", name:"Kimi K2.6 32B", cls:"mid_sh",
    clsLabel:"Self-hosted mid (30–50B)", api:false,
    in:AKKA_MID_IN, out:AKKA_MID_OUT},
  {key:"sh:deepseek-v4-pro", name:"DeepSeek V4-Pro 49B (self-hosted)", cls:"mid_sh",
    clsLabel:"Self-hosted mid (30–50B)", api:false,
    in:AKKA_MID_IN, out:AKKA_MID_OUT},
  {key:"sh:qwen3-32b", name:"Qwen3 32B", cls:"mid_sh",
    clsLabel:"Self-hosted mid (30–50B)", api:false,
    in:AKKA_MID_IN, out:AKKA_MID_OUT},
  {key:"sh:deepseek-v3-2", name:"DeepSeek V3.2 (37B active)", cls:"mid_sh",
    clsLabel:"Self-hosted mid (30–50B)", api:false,
    in:AKKA_MID_IN, out:AKKA_MID_OUT},
  // Self-hosted upper-mid (50–100B active params)
  {key:"sh:llama-3-3-70b", name:"Llama 3.3 70B", cls:"umid_sh",
    clsLabel:"Self-hosted upper-mid (50–100B)", api:false,
    in:AKKA_UMID_IN, out:AKKA_UMID_OUT},
  // Self-hosted large (100B+ active params)
  {key:"sh:kimi-k3", name:"Kimi K3 104B", cls:"large_sh",
    clsLabel:"Self-hosted large (100B+)", api:false,
    in:AKKA_LARGE_IN, out:AKKA_LARGE_OUT},
  {key:"sh:qwen3-vl-235b", name:"Qwen3 VL 235B", cls:"large_sh",
    clsLabel:"Self-hosted large (100B+)", api:false,
    in:AKKA_LARGE_IN, out:AKKA_LARGE_OUT},
  {key:"sh:mistral-large-3", name:"Mistral Large 3 123B", cls:"large_sh",
    clsLabel:"Self-hosted large (100B+)", api:false,
    in:AKKA_LARGE_IN, out:AKKA_LARGE_OUT},
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
