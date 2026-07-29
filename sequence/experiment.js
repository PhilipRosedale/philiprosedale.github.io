// One experiment = build, train, measure. Shared by the sweep workers and by
// any interactive tooling.

import {
  DEFAULT_CONFIG,
  Network,
  uniqueCharacters,
  firstOrderCeiling,
  chanceLevel,
  train,
  recall,
  weightSelectivity,
  analyzeConvergence,
  measurePropagation,
} from "./net.js";

export function runOne({
  overrides = {},
  sequence,
  presentations = 120,
  seedChars = 3,
  seeds = 1,
  // Recall must run long enough for accuracy to have useful resolution; scoring
  // a single pass of a 7-character sequence gives only 4 samples.
  recallChars = 60,
}) {
  const repeats = Math.max(1, Math.ceil(recallChars / sequence.length));
  const recallSequence = sequence.repeat(repeats);
  const results = [];
  for (let s = 0; s < seeds; s++) {
    const cfg = { ...DEFAULT_CONFIG, ...overrides, seed: (overrides.seed ?? 1) + s };
    const net = new Network(cfg);
    net.assignAssemblies(uniqueCharacters(sequence), cfg.assemblySize);
    const structure = analyzeConvergence(net, { hops: 1 });
    train(net, sequence, { presentations });
    const sel = weightSelectivity(net, sequence + sequence[0]);
    const prop = measurePropagation(net, sequence);
    // Free replay of an STDP-trained sequence is compressed, so the readout
    // clock has to be found rather than assumed.
    let r = recall(net, recallSequence, { seedChars, tempoScale: 1 });
    let tempo = 1;
    for (let ts = 0.7; ts <= 1.101; ts += 0.025) {
      const candidate = recall(net, recallSequence, { seedChars, tempoScale: ts });
      if (candidate.accuracy > r.accuracy) {
        r = candidate;
        tempo = ts;
      }
    }
    const stats = net.stats();
    results.push({
      propagation: prop.propagationFraction,
      gain: prop.meanGain,
      accuracy: r.accuracy,
      tempo,
      runLength: r.runLength,
      silentFraction: r.silentFraction,
      selectivity: sel.selectivity,
      transitionMean: sel.transitionInWindow.mean,
      transitionAtMax: sel.transitionInWindow.fracAtMax,
      otherMean: sel.otherInWindow.mean,
      otherAtMax: sel.otherInWindow.fracAtMax,
      ratePerT: stats.ratePerT,
      fracAtMax: stats.fracAtMax,
      drivable: structure.meanDrivableCells,
    });
  }
  const avg = {};
  for (const k of Object.keys(results[0])) {
    avg[k] = results.reduce((a, r) => a + r[k], 0) / results.length;
  }
  avg.firstOrderCeiling = firstOrderCeiling(sequence);
  avg.chance = chanceLevel(sequence);
  return avg;
}
