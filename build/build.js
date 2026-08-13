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
const PRE=${a.prefillTokS},DEC=${a.decodeTokS},GPN=${a.gpusPerNode},HRS=${a.hoursPerYear},PEAK=${a.peakFactor};
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
const CAP={low:"Low",base:"Base",high:"High",max:"Max"};`;

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
