// Is STDP strengthening the synapses that carry the sequence?
//
// This is upstream of recall accuracy. If selectivity is ~1.0 the network has
// learned nothing and no amount of readout tuning will help. If selectivity is
// high but recall still fails, the problem is in the recall dynamics instead.

import { DEFAULT_CONFIG, Network, uniqueCharacters, train, recall, weightSelectivity } from "./net.js";

const SEQ = "ABCDEFG";

function run(label, overrides, presentations = 80) {
  const cfg = { ...DEFAULT_CONFIG, ...overrides };
  const net = new Network(cfg);
  net.assignAssemblies(uniqueCharacters(SEQ), cfg.assemblySize);
  train(net, SEQ, { presentations });
  const sel = weightSelectivity(net, SEQ + SEQ[0]);
  const r = recall(net, SEQ.repeat(5), { seedChars: 3 });
  const stats = net.stats();
  console.log(
    label.padEnd(34) +
      sel.selectivity.toFixed(2).padStart(6) +
      sel.transitionInWindow.mean.toFixed(3).padStart(9) +
      sel.otherInWindow.mean.toFixed(3).padStart(9) +
      sel.transitionOutOfWindow.mean.toFixed(3).padStart(9) +
      sel.background.mean.toFixed(3).padStart(9) +
      (100 * r.accuracy).toFixed(0).padStart(7) + "%" +
      stats.ratePerT.toFixed(2).padStart(8)
  );
  return { sel, r };
}

console.log("Sequence " + SEQ + ", one successor per character.\n");
console.log(
  "config".padEnd(34) +
    "  sel".padStart(6) +
    " trans/win".padStart(9) +
    " other/win".padStart(9) +
    " trans/out".padStart(9) +
    "   bkgd".padStart(9) +
    "   acc".padStart(8) +
    "  rate/T".padStart(8)
);
console.log("-".repeat(92));

run("baseline", {});
run("hard bounds", { softBounds: false });
run("hard bounds, aPlus x4", { softBounds: false, aPlus: 0.032 });
run("hard bounds, aPlus x10", { softBounds: false, aPlus: 0.08 });
run("hard bounds, quiet (rate 0.3)", { softBounds: false, targetRateT: 0.3 });
run("hard bounds, quiet + aPlus x4", { softBounds: false, targetRateT: 0.3, aPlus: 0.032 });
run("no background noise", { softBounds: false, aPlus: 0.032, noiseRateT: 0 });
run("no homeostasis", { softBounds: false, aPlus: 0.032, thetaGain: 0 });
run("aMinusRatio 1.5", { softBounds: false, aPlus: 0.032, aMinusRatio: 1.5 });
run("aMinusRatio 0.9 (LTP dominant)", { softBounds: false, aPlus: 0.032, aMinusRatio: 0.9 });
run("no lateral inhibition", { softBounds: false, aPlus: 0.032, lateralInhibition: 0 });
run("assembly 40", { softBounds: false, aPlus: 0.032, assemblySize: 40 });
run("300 presentations", { softBounds: false, aPlus: 0.032 }, 300);
