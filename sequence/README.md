# Sequence learning in a spiking network

A headless research harness for making a spiking network learn a sequence of
characters, built as a successor to `../interactiveNeurons.html`. It preserves
that model's three defining features:

- Hebbian STDP on excitatory synapses
- an absolute refractory period after each spike
- axonal transmission time proportional to the distance between neurons

The simulation is separated from any rendering so parameter sweeps can run
thousands of times faster than real time. `net.js` is a plain ES module that
runs unchanged in Node and in the browser, so a p5 sketch can eventually import
the same simulation the sweeps use.

## Status

Verified across 8 independent networks (`node seeds.js`), 400 presentations each.

| | `ABCDEFG` | the tune `EEFGGFEDCC...` |
|---|---|---|
| selectivity | **7.39 ± 0.68** | 7.43 ± 1.73 |
| single-step propagation | **100% ± 0%** | 29% ± 8% |
| propagation gain | 0.58 | 0.38 |
| recall accuracy | 27% ± 3% (chance 14%) | 28% ± 3% (chance 20%) |
| longest correct run | **0.5 ± 1.3** | 0.3 ± 0.4 |

Read that as: the network reliably learns the transitions, and reliably fires
the correct successor one step ahead. It does **not** reliably chain. Recall is
statistically well above chance (11 standard errors on `ABCDEFG`) but that comes
from being right at scattered positions, not from replaying a contiguous
stretch. One seed produced a 4-character replay (`DEF` seeded, `DEFFGAB`
produced); the other seven produced runs of zero.

`firstOrderCeiling()` reports what a perfect pairwise-association model could
achieve. On the tune that is 48%, and we are at 28% — so the network has not yet
demonstrated it is using context rather than pairwise association.

## The blocker

**The travelling packet decays**: 39 → 24 → 10 → 3 spikes over four character
intervals. Everything upstream of this is solid and every metric downstream is
pinned at zero because of it. Fix this before measuring anything else.

Global inhibition (`globalInhibition`) is what holds the packet size, and it is
sharply tuned — 0.005 to 0.01 works, 0 lets it randomise, 0.02 strangles it.
That window is only a factor of two wide, which suggests the packet is being
held by a single mechanism that needs help, likely from a slow adaptation
current or from tuning the recovery of global inhibition against recurrent gain.

## Why the original sketch could not learn

Measured, not assumed, by porting `interactiveNeurons.html`'s dynamics headless:

- The network was firing at **92% of its refractory ceiling** — a seizure. The
  cause was the leak: `leakageRate = 0.1` subtracted *linearly* means charge
  takes 10 seconds to drain, so every neuron is a near-perfect integrator.
- Over 60 seconds of the training tune there was exactly **one** STDP
  potentiation event on a synapse connecting consecutive characters.
- Only **2 of the 12** distinct character transitions had a direct synapse at
  all, with one neuron per character and 8 nearest-neighbour connections.
- **0.8%** of synapses had a delay in the potentiation window for the tune's
  tempo. 17.6% of weights ended pinned at +1.

## Design laws found

**1. Delay matching.** For a spike from A to potentiate the synapse onto B when
they are `T` apart in the sequence, the axonal delay must satisfy
`T - tau_stdp < d/v < T`. This is why distance-dependent delay is the right
feature to have kept: it is the only thing in the model that can represent an
interval of time.

**2. Connectivity is a distance shell, not a count.** The synapses that can ever
carry a `T`-second transition lie in a shell of radius `r* = v*T`. `numNeighbors`
only matters through whether the K-nearest ball reaches that shell:

    K > pi * (velocityT * minSpacing)^2 / areaPerNeuron

Beyond that, extra neighbours add nothing — they are all at the wrong distance.
Verified: fan-in collapses exactly where the ball fails to reach, and plateaus
once it covers.

**3. Coding density, not assembly size.** What matters is `k/N`. At fixed
assembly size, going from N=400 to N=800 *dropped* drivable cells from 2.03 to
0.58. With `C` characters and 80% excitatory neurons, non-overlapping assemblies
cap density at `0.8/C` — 0.114 for 7 characters, and we run at 0.10, so this
lever is nearly exhausted. Breaking it requires assemblies that share neurons.

**4. Expected in-window fan-in.**

    mu = (k/N) * 2*pi * velocityT^2 * 3*tauPlusT * (minSpacing^2 / areaPerNeuron)

Fan-in scales with the *square* of velocity; synchrony of the arriving volley
depends only on `tauPlusT`. So they are independent levers in principle.

**5. The gain law.** Propagation gain is set by how many coincident learned
synapses a target cell needs:

    gain ~ P(Poisson(mu) >= ceil(threshold / learned weight))

At mu=1.8 with a learned weight of 0.72 against threshold 1.0 this predicts
0.54; measured was 0.57. If one synapse sufficed it would be `1 - exp(-mu)` =
0.83. The lever is the *ratio* of learned weight to effective threshold.

**6. Replay is compressed.** STDP can only strengthen a synapse whose spike
arrives *before* the postsynaptic cell fires, so every learned delay is shorter
than `T` and free replay runs fast — direct measurement showed peaks at 0.8,
1.8, 2.8 T, a constant lead rather than a compounding drift. This matches
hippocampal replay in rodents and is a property, not a bug. `recall()` takes a
`tempoScale` for it. Caveat: across 8 seeds the best-fit tempo scatters 0.75 to
1.10 with no consistent bias, so at current accuracy the tempo scan is largely
fitting noise. The direct `packet.js` measurement is the trustworthy evidence.

## Dead ends — do not re-litigate these

- **Soft (multiplicative) bounds.** Every weight converges to
  `wMax * A+/(A+ + A-)` — predicted 0.286, measured 0.299 — a narrow unimodal
  blob with no structure. Use hard bounds so the distribution can split.
- **LTP-dominant STDP.** `aMinusRatio` below 1 gives selectivity below 1, i.e.
  worse than no learning. Selectivity rises monotonically with it: 1.06 at
  ratio 1.0, 1.82 at 2.0, 8.0 at 3.0.
- **Fast learning.** `aPlus = 0.08` over 600 presentations gives 0% propagation;
  `aPlus = 0.008` over the same 600 gives 100%. Slow and repeated wins.
- **Lowering the threshold.** Does nothing — gain sat at 0.45–0.60 across
  thresholds 0.5 to 1.0, because homeostasis raises theta to compensate. With
  adaptive thresholds in the loop, absolute threshold is not a free parameter.
- **velocityT above 6.** Fan-in doubles but gain *falls* (0.57 at 5, to 0.19 at
  8) because potentiation spreads over more synapses and short delays create
  fast recurrent loops.
- **Long-range random axons.** Dropped delay coverage from 83% to 22%. A
  distance-weighted heavy tail might help; uniform random does not.
- **`tauPlusT = 0.06T`.** Too narrow, breaks propagation entirely. 0.12–0.18
  is the usable band.
- **Lateral inhibition during early training.** Kills propagation gain, because
  the number of cells that fire is exactly what drives the next step. It is
  annealed instead (`lateralInhibitionStart/End`). Note that annealing to 0.3
  reaches gain 1.00 but only by shrinking the packet to 2 cells, far below what
  survives noise.
- **Unidirectional homeostasis.** The adaptive threshold must be allowed to go
  negative or a silent neuron can never become more excitable and the network
  has no route back from the dead regime.

## Layout

Everything is parameterised as ratios to a single timescale `T`, the interval
between characters, so changing `T` rescales the whole simulation coherently.

| file | purpose |
|---|---|
| `net.js` | the simulation, plus all the analysis functions |
| `experiment.js` | build, train, measure — one experiment |
| `sweep.js` / `worker.js` | parallel sweep harness over worker threads |
| `sweeps.js` | named sweeps: `noise` `window` `rate` `gain` `saturate` `shellwidth` `gainpush` `anneal` `chain` `structure` |
| `seeds.js` | multi-seed robustness check — **always confirm findings here** |
| `validate.js` | end-to-end summary of the current defaults |
| `packet.js` | packet size and replay tempo over several intervals |
| `association.js` | per-transition impulse response, background silenced |
| `stdp.test.js` | verifies the STDP curve against the analytic form |
| `regime.js` | maps the alive-but-not-saturated operating regime |
| `shell.js` / `scaling.js` | structural feasibility analyses |

```
node validate.js          # where things stand
node seeds.js             # robustness across 8 networks, ~40s
node sweeps.js gain       # any named sweep
node stdp.test.js         # sanity check the learning rule
node packet.js ABCDEFG '{"globalInhibition":0.005}' 300
```

Metrics, in the order they should be checked — each is upstream of the next, so
diagnose in this order:

1. **selectivity** — are sequence-carrying synapses stronger than identically
   delayed synapses that carry nothing? 1.0 means nothing was learned.
2. **propagation** — does firing one assembly alone make the correct successor
   fire at `T`?
3. **gain** — spikes out over spikes in. Below 1 the chain shrinks each step.
   Always check the *absolute* packet size too; gain can reach 1 trivially by
   shrinking both sides.
4. **accuracy / longest run** — free-running recall. Compare against
   `firstOrderCeiling`, not against 100%.

## Next steps, ranked

1. **Stop the packet decaying.** The only real blocker. See above.
2. **Context disambiguation.** Propagation on the tune is 29% versus 100% on the
   clean sequence, so ambiguity degrades the *association itself*, not just
   recall — each character's outgoing synapses get pulled toward conflicting
   successors. Context is a prerequisite, not a refinement. The annealed lateral
   inhibition is the intended mechanism and is already implemented.
3. **The p5 visualization.** Import `net.js` directly. Render only synapses above
   a weight threshold — after learning most weights are near zero, so the display
   would show the learned skeleton emerging from a faint background, which is a
   better visualization than drawing all 32,000 synapses.
