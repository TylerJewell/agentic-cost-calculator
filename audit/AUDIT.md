# Audit instructions

Standing instructions for re-verifying every figure behind `index.html`. Run quarterly, or
whenever a hyperscaler announces pricing changes.

An agent executing this file needs no prior context. Every figure it must check is listed in
`rates.json` with its current value, its source and how confident we are in it.

---

## The three rules that govern a run

**1. Unit cost may not rise.** The tracked metric is Akka's cost per million tokens at 5T, 25T
and 100T — not absolute cost, which grows with the customer. A run that produces a higher unit
cost than the previous run is a regression. It must be explained in writing before it is
accepted. The explanation is either a real input-price increase we have to respond to, or a
modelling error. Both require a decision. Neither is absorbed silently.

**2. Every `estimated` and `unconfirmed` figure is re-attempted every run.** Those are where we
have been wrong before. A figure that has been estimated for four consecutive runs without
anyone trying to confirm it should be escalated, not carried forward again.

**3. Errors that favour Akka are found before errors that hurt Akka.** The honesty register
below lists every place the model currently flatters us. Check those first. A comparison that
survives adversarial review is worth more than one that wins.

---

## Dimensions to check

### A. Model catalogue and availability

For each of AWS Bedrock, Azure AI Foundry, Google Vertex Model Garden, confirm which models in
`rates.json → inference` are still served, and find models newly added that would change a mix.

- A model leaving a catalogue invalidates the mix that names it.
- A stronger model entering a catalogue raises that provider's accuracy ceiling and must be
  reflected. **This works against us and must not be skipped.**
- Note the billing model, not just the rate. Google sells open weights per endpoint hour, not
  per token. If that changes, the whole Google derivation changes.

### B. Inference rates

Re-collect every per-token rate. Authoritative source is the provider's own pricing page.
Azure's pages render client-side and show placeholders to a fetch — use an aggregator and record
which one, or ask a human with a signed-in browser.

Tolerance: **any change** is recorded. A change above 10% is flagged.

### C. Agent runtime and memory

These diverge by billing model, not just by rate, and that is where the largest errors have
been. For each provider confirm:

- Is there a charge to run an agent at all? (Azure: no. AWS and Google: yes, per vCPU-hour and
  GB-hour.)
- Is memory metered per event, or monthly against an accumulating balance? (AWS: monthly, which
  compounds. Google: per event, which does not. Azure: customer-assembled.)
- If AWS drops the monthly memory accrual, a large part of our AWS advantage disappears.
  **Check this every run.**

### D. Observability, storage, support, professional services

Carried at AWS figures on all three providers. That is currently justified by measurement —
Google Cloud Logging and Premium Support match AWS closely. Re-confirm the match. If any
provider diverges more than 15%, that line must be derived per provider.

### E. GPU rates

Both list and committed, for every source in `rates.json → gpu`. The committed rates are the
weakest figures in the whole model and the highest value to confirm.

- AWS reserved p5 and p6: **assumed at 50% off list and never verified.** This single figure
  moves Akka's cost by ±39%. Get it in writing.
- Azure ND H100 v5 reserved: **assumed at 40% off.**
- Google a3: published 3-year CUD of 6% — the only committed rate of the three that is
  published rather than assumed. Confirm it has not moved.
- Google a4 (B200) is excluded from CUD because Google routes A4 through AI Hypercomputer
  reservations. Confirm that is still true.
- Neocloud rates move fast and are contract-oriented. Lambda's low figure may be spot or
  promotional; confirm it is a rate we can actually hold for a year.

### F. Accuracy benchmarks

SWE-bench Verified for every model in the mixes. Published results only; estimates must be
labelled. Watch for:

- New open-weight models above the current 80.2% ceiling, which would change Akka's base model.
- Any published score for a Ministral variant. We currently use Qwen3-8B at 8.0% as a
  size-class proxy for models that publish nothing.
- Whether the best-of-three uplift has been measured on our actual configuration rather than
  inferred from a published scaffold result.

### G. Serving throughput

25,000 tokens/second prefill and 3,000 decode per H100, and 3× that for B200. These are
first-principles estimates that have never been benchmarked. Our own internal analysis warned
that mixed sequence lengths land 1.5–2× worse. **A benchmark on real traffic retires the
largest single uncertainty in the model.**

### H. Capacity projection

The page tells customers the same reserve carries 1.6× in year two and 2.6× in year three. That
is a commitment. Check whether realised throughput per GPU-hour is on pace. If it is not, the
promise breaks before the pricing does.

---

## Honesty register

Places the model currently favours Akka. Re-examine each run and record whether the bias has
grown.

| # | Where | Direction | Note |
|---|---|---|---|
| 1 | Vertex per-model container fee excluded | Understates Google | Published per Marketplace listing, not centrally. Google's real cost is higher than shown. |
| 2 | Azure memory at $60K | Understates Azure's capability, not its cost | AgentCore performs extraction and consolidation a customer assembling Cosmos DB would build themselves. Infrastructure comparison only. |
| 3 | AWS reserved discount assumed at 50% | Understates Akka's cost | At list price the 5T deal is break-even. This is the single largest exposure. |
| 4 | Adapter coefficients invented | Overstates Akka's savings | 40% of input, 60% of output, half the compute. No source. |
| 5 | Peak factor 2.8 measured at pooled scale | Understates Akka's cost | Azure's traces are already smoothed across customers. A single tenant's true peak is higher. |
| 6 | Professional services fixed per case | Overstates hyperscaler cost at low volume | $700K on the Base case regardless of volume. Negligible above 25T, material at 1T. |
| 7 | Akka accuracy at 80.2% single-pass | Honest | The published base-model score, not a modelled uplift. Keep it that way. |

---

## Output

Write `findings/YYYY-MM-DD.md` containing:

1. **Verdict** — pass, or regression requiring a decision.
2. **Unit cost ratchet** — Akka $/M tokens at 5T, 25T, 100T against the previous run.
3. **Changed figures** — old value, new value, source, effect on the headline numbers.
4. **Still unconfirmed** — every figure at `estimated` or `unconfirmed`, with how many runs it
   has carried that status.
5. **Honesty register** — any bias that grew, and any new one introduced.
6. **Recommended edits** — specific changes to `rates.json` and `index.html`.

Update `rates.json` in the same commit. Never edit a figure without updating its `verified`
date, its `source`, and its `confidence`.
