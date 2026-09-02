# Rate review notes

Companion to `AUDIT.md`. Standing flags for `rates.json` entries whose
figures look inconsistent with published or observed market rates as of
the sovereign calculator's calibration pass. A quarterly audit should
either verify each against a current source and update the figure, or
add an explicit "verified $DATE, source X" line to the confidence field
of the affected block.

## Neocloud GPU rates

The neocloud entries under `runtime.gpuSources` deserve scrutiny. All
figures are per-8-GPU-node-hour; divide by 8 for per-GPU-hour.

### CoreWeave committed H100 — $4.62/GPU-hr

`coreweavec.h100 = 36.96` per node-hour = **$4.62/GPU-hr**.

This is more expensive per GPU-hour than AWS reserved H100 ($3.44/GPU-hr,
which is itself aggressive), and materially above what CoreWeave was
quoting publicly on 1–3 year committed contracts in 2025 (typically
$2.00–$3.00/GPU-hr for H100 SXM 80GB). A CoreWeave 3-year committed H100
contract signed at 2026 market rates should sit around $2.50/GPU-hr =
**$20/node-hr**.

Impact in the sovereign calculator: this entry pushes the CoreWeave
committed H100 multiplier to 0.860 — barely cheaper than the GCP baseline
of 1.0, which contradicts how CoreWeave is positioned in the market.

### CoreWeave committed B200 — $4.88/GPU-hr

`coreweavec.b200 = 39` per node-hour = **$4.88/GPU-hr**.

Plausible but at the low end of committed B200 pricing observed in
2026. Worth verifying against a current CoreWeave quote.

### Lambda B200 tiers collide

`lambdalow.b200 = 44` and `lambda.b200 = 44` — identical values. But the
labels differentiate them: `lambdalow` claims $1.49/GPU-hr and `lambda`
claims $2.99/GPU-hr. If the label pricing is authoritative, `lambdalow`
should have `b200 = 8 × 1.49 = 11.92` (matching its H100 entry), not 44.

Impact: the calculator treats both Lambda B200 tiers identically for
sovereign compute, which under-represents the low-cost tier's advantage
and inflates the low-tier multiplier.

### Nebius on-demand B200 vs Lambda B200 collision

`nebius.b200 = 44` — identical to both Lambda B200 entries. A single
$5.50/GPU-hr B200 rate across three different providers with different
service tiers is suspicious and probably a placeholder that predates
Blackwell general availability. Nebius's 2026 quotes should be verified.

## AWS reserved rates are aggressive

`aws.h100 = 27.52` = **$3.44/GPU-hr**. This matches an aggressive 3-year
all-upfront Reserved Instance on p5.48xlarge (or an EDP-discounted
Savings Plan). It is *not* what a normal customer sees on the AWS
pricing page. `aws.b200 = 56.97` = **$7.12/GPU-hr** for p6-b200.48xlarge
under the same terms.

These figures are consistent with the main calc's methodology paragraph,
which states the modelled rate. But they set a floor that many neocloud
committed contracts cannot beat — so a customer running the sovereign
calculator with the wrong assumption about what "AWS reserved" means may
misinterpret the multiplier. Consider adding a note in `rates.json`'s
confidence field for `aws` and `awsod` clarifying the tier assumed.

## What the sovereign calculator does with these

`hostMultiplier()` normalises the chosen source against GCP reserved
B200 ($16.11/GPU-hr = $128.88/node-hr), matching the reference the main
calc's methodology paragraph uses to derive AKKA_SMALL_IN=$0.09,
AKKA_MID_IN=$0.25 and AKKA_LARGE_IN=$0.37. So an inaccurate rate here
flows directly into the OPTIMIZED figure — a 2× off rate produces a 2×
off per-token cost on self-hosted destinations.

## Google and xAI per-token rates are estimates

`inference.google_direct` and `inference.xai_direct` carry
`confidence: "estimated"` and no `verified` date. Unlike every other
per-token block in this file, these figures were not read off a
published price card. They were positioned against the OpenAI and
Anthropic tiers already present, on the reasoning that a vendor's cheap
and frontier tiers sit near their competitors':

| Model | in / out | Positioned against |
|---|---|---|
| `gemini-3-flash` | 0.15 / 1.20 | `gpt-5.6-luna` at 0.20 / 1.20 |
| `gemini-3-pro` | 2.00 / 12.00 | `gpt-5.6-terra` at 2.00 / 12.00 |
| `grok-5-fast` | 0.25 / 1.50 | `gpt-5.6-luna`, one step up |
| `grok-5` | 3.00 / 15.00 | `claude-sonnet-5` at 3.00 / 15.00 |

Impact in the sovereign calculator: all four appear as selectable
destinations. Selecting one sets the cheap tier or the frontier for
every routing technique, so an inaccurate rate moves both the OPTIMIZED
figure and the break-even volume. The four are the only entries in the
model catalog not traceable to a published or corroborated source.

These must be replaced with published figures before the page is shown
to a customer.

## What to check on the next audit

- Google Gemini published API pricing — replace the four estimated
  entries above with verified figures and a `verified` date
- xAI Grok published API pricing — same
- CoreWeave committed H100 rate against a current CoreWeave contract quote
- CoreWeave committed B200 rate against a current quote
- Lambda `lambdalow.b200` value — should probably be 11.92, not 44
- Nebius on-demand B200 rate — the $44 value is shared with two other
  entries and may be a placeholder
- AWS reserved and on-demand rates — clarify which tier's discount is
  assumed in the confidence field
