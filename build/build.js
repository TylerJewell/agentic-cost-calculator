#!/usr/bin/env node
/*
  Generates index.html from build/template.html + audit/rates.json.

  The generated page is standalone: every figure is baked in as literals, and it
  never fetches rates.json at runtime. Edit rates.json -> runtime, run this, commit
  both files together.

    node build/build.js
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RATES = path.join(ROOT, "audit", "rates.json");
const TEMPLATE = path.join(__dirname, "template.html");
const OUT = path.join(ROOT, "index.html");
const MARKER = "/*__MODEL__*/";

const rates = JSON.parse(fs.readFileSync(RATES, "utf8"));
const r = rates.runtime;
if (!r) fail("rates.json has no `runtime` block");

// ---- the figures the page needs, emitted as plain literals ----
const j = (v) => JSON.stringify(v);
const a = r.akka;


// ---- break-even tab: provider list and base-model map ----
// Open-weight API models are self-hosted as themselves. Proprietary ones take the
// nearest open weight by capability class. N is dense-equivalent ACTIVE parameters,
// which is what throughput scales on for a mixture-of-experts model.
const BE_BASE = {
  "claude-haiku-4-5":    ["Qwen3 Coder Next", 3],
  "claude-sonnet-5":     ["Kimi K2.6", 32],
  "claude-opus-5":       ["DeepSeek V4-Pro", 49],
  "claude-fable-5":      ["Kimi K3", 104],
  "Claude Cowork":            ["Kimi K3", 104],
  "Microsoft Copilot Studio": ["Qwen3 Coder Next", 3],
  "Salesforce Agentforce":    ["Qwen3 Coder Next", 3],
  "HubSpot Breeze":           ["MiniMax M2.5", 10],
  "Aissist.io":               ["MiniMax M2.5", 10],
  "Gorgias AI Agent":         ["MiniMax M2.5", 10],
  "Intercom Fin":             ["MiniMax M2.5", 10],
  "Zendesk AI Agents":        ["MiniMax M2.5", 10],
  "gpt-5.6-luna":        ["MiniMax M2.5", 10],
  "gpt-5.6-terra":       ["GLM-5.2", 40],
  "gpt-5.6-sol":         ["DeepSeek V4-Pro", 49],
  "deepseek-v4-flash":   ["DeepSeek V4-Flash", 15],
  "deepseek-v4-pro":     ["DeepSeek V4-Pro", 49],
  "ministral-3b":        ["Ministral 3B", 3],
  "ministral-8b":        ["Ministral 8B", 8],
  "llama-4-scout":       ["Llama 4 Scout", 17],
  "llama-4-maverick":    ["Llama 4 Maverick", 17],
  "qwen3-next-80b":      ["Qwen3 Next 80B", 3],
  "qwen3-coder-next":    ["Qwen3 Coder Next", 3],
  "mistral-large-3":     ["Mistral Large 3", 123],
  "mistral-medium-2505": ["Mistral Medium", 24],
  "qwen3-vl-235b":       ["Qwen3 VL 235B", 22],
  "minimax-m2.5":        ["MiniMax M2.5", 10],
  "deepseek-v3.2":       ["DeepSeek V3.2", 37],
  "deepseek-r1":         ["DeepSeek R1", 37],
  "phi-4":               ["Phi-4", 14],
};
const BE_GROUPS = [
  ["anthropic_direct", "Anthropic"], ["openai_direct", "OpenAI"],
  ["deepseek_direct", "DeepSeek"], ["aws_bedrock", "AWS Bedrock"],
  ["azure_ai_foundry", "Azure AI Foundry"], ["per_task", "Per outcome"],
];
const beApis = [];
for (const [key, label] of BE_GROUPS) {
  const p = rates.inference[key];
  if (!p || !p.models) continue;
  for (const [m, v] of Object.entries(p.models)) {
    const b = BE_BASE[m];
    if (!b) continue;
    if (v.usd_per_task !== undefined)
      beApis.push({ g: label, m, task: v.usd_per_task, tpt: v.tokens_per_task || p.tokens_per_task, u: v.unit, b: b[0], n: b[1] });
    else if (v.in !== undefined)
      beApis.push({ g: label, m, i: v.in, o: v.out, b: b[0], n: b[1] });
  }
}

const model = `// GENERATED from audit/rates.json by build/build.js. Do not edit here.
// Baseline ${rates.baseline}. Regenerate with: node build/build.js
const TABS=${j(r.tabs)};
const SLUGS=${j(r.slugs)};
const PRESETS=${j(r.presets)};
const WORKLOADS=${j(r.workloads)};
const TECHS=${j(r.techniques)};
const PROV=${j(r.providers)};
let MIXES=PROV.aws.mixes;
const MAX_MULT=${a.maxMultDefault || 3.35};
const ACC=Object.assign({},PROV.aws.acc,{akka:${r.akkaAccuracy}});
const LAT=Object.assign({},PROV.aws.lat,{akka:${r.akkaLatency}});
const HOST=${j(r.hostProfiles)};
const SVC=${j(r.services)};
const STO5=${j(r.storageAt5T)};
let PRE=${a.prefillTokS},DEC=${a.decodeTokS};const PRE0=PRE,DEC0=DEC,N0=12;
const GPN=${a.gpusPerNode},HRS=${a.hoursPerYear},PEAK=${a.peakFactor};
const SRC=${j(r.gpuSources)};
const FLEETS=${j(r.fleets)};
const fleets=k=>FLEETS.map(f=>({node:f.node,gpu:f.gpu,rate:SRC[k][f.rateKey],tp:f.tp}));
const MIN_NODES=${a.minNodes},CPU_MIN=${a.cpuStorage.minimum},MISC=${a.misc};
// compute and storage follow deployed agents and end-user traffic, not GPU spend,
// so they depend on volume alone and are identical on every cloud
const CPU_FIRST=${a.cpuStorage.first},CPU_FLOOR=${a.cpuStorage.floor},CPU_DECAY=${a.cpuStorage.decay},CPU_BLOCK=${a.cpuStorage.blockB};
function cpuStorageFor(volB){
  const full=Math.ceil(volB/CPU_BLOCK); let t=0;
  for(let n=0;n<full;n++) t+=CPU_FLOOR+(CPU_FIRST-CPU_FLOOR)*Math.pow(CPU_DECAY,n);
  const frac=(volB%CPU_BLOCK)||CPU_BLOCK;
  t-=(CPU_FLOOR+(CPU_FIRST-CPU_FLOOR)*Math.pow(CPU_DECAY,full-1))*(1-frac/CPU_BLOCK);
  return Math.max(CPU_MIN,t);
}
const ADAPT=${j(a.adapter)};
const CACHE_SAVING=${a.cacheSaving},SPEC_MULT=${a.specMultiple},BATCH_MULT=${a.batchMultiple},FLOOR_FRAC=${a.floorFraction};
const TRAIN_HOURS_5T=${a.trainingHoursAt5T};
const MRG_HI=${a.margin.hi},MRG_LO=${a.margin.lo},MRG_V0=${a.margin.v0},MRG_V1=${a.margin.v1};
const MIN_VOLUME_B=${a.minVolumeB},Y2=${a.capacityY2},Y3=${a.capacityY3};
const CAP={low:"Low",base:"Base",high:"High",max:"Max"};
const BE_APIS=${j(beApis)};
const BE_CACHE=${rates.inference.prompt_cache.effective_input_multiple};
const BE_HAIRCUT=${rates.serving_throughput.mixed_length_haircut};`;

// ---- integrity checks: the mixes must agree with the documented rate cards ----
const checks = [
  ["AWS High input", r.providers.aws.mixes.high[0].i,
    rates.inference.aws_bedrock.models["gpt-5.6-luna"].in],
  ["AWS High output", r.providers.aws.mixes.high[0].o,
    rates.inference.aws_bedrock.models["gpt-5.6-luna"].out],
  ["Azure High input", r.providers.azure.mixes.high[0].i,
    rates.inference.azure_ai_foundry.models["gpt-5.6-luna"].in],
  ["AWS reserved H100", r.gpuSources.aws.h100, rates.gpu.aws_p5_h100.reserved_hour],
  ["AWS on-demand H100", r.gpuSources.awsod.h100, rates.gpu.aws_p5_h100.list_hour],
  ["Google reserved H100", r.providers.gcp.vpcH100, rates.gpu.google_a3_h100.reserved_hour],
  ["AWS on-demand H100 (in-VPC)", r.providers.aws.vpcOdH100, rates.gpu.aws_p5_h100.list_hour],
  ["Azure on-demand H100", r.providers.azure.vpcOdH100, rates.gpu.azure_nd_h100_v5.list_hour],
  ["Azure on-demand B200", r.providers.azure.vpcOdB200, rates.gpu.azure_nd_b200.list_hour],
  ["Google on-demand H100", r.providers.gcp.vpcOdH100, rates.gpu.google_a3_h100.list_hour],
  ["AgentCore vCPU-hour", r.providers.aws.host.v, rates.agent_runtime.aws_agentcore.vcpu_hour],
  ["Agent Engine vCPU-hour", r.providers.gcp.host.v, rates.agent_runtime.google_agent_engine.vcpu_hour],
  ["Azure memory flat", r.providers.azure.mem.flat, rates.memory.azure_assembled.annual_usd],
  ["Akka accuracy", r.akkaAccuracy, rates.accuracy_swebench_verified["minimax-m2.5"].score],
];
let bad = 0;
for (const [label, got, want] of checks) {
  if (got !== want) { console.error(`  MISMATCH  ${label}: runtime ${got} vs rate card ${want}`); bad++; }
}
if (bad) fail(`${bad} figure(s) disagree between runtime and the documented rate cards`);

// ---- inject ----
const tpl = fs.readFileSync(TEMPLATE, "utf8");
if (!tpl.includes(MARKER)) fail(`template.html has no ${MARKER} marker`);
const out = tpl.replace(MARKER, model);
// standalone means no runtime load of anything local; a provenance comment is fine
for (const pattern of [/fetch\s*\(/, /XMLHttpRequest/, /<script[^>]+src=["'](?!https:)/]) {
  if (pattern.test(out)) fail(`generated page loads something at runtime (${pattern}) — it must stand alone`);
}
fs.writeFileSync(OUT, out);

console.log(`built index.html  (${(out.length / 1024).toFixed(1)} KB)`);
console.log(`  ${checks.length} integrity checks passed`);
console.log(`  ${Object.keys(r.providers).length} providers, ${Object.keys(r.gpuSources).length} GPU sources`);

function fail(m) { console.error("BUILD FAILED: " + m); process.exit(1); }
