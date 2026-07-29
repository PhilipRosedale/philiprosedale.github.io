// Unit test: does a single synapse reproduce the STDP curve?
//
// Builds a two-neuron network, forces a presynaptic spike and a postsynaptic
// spike separated by a known interval, and compares the measured weight change
// against the analytic expression.

import { Network, DEFAULT_CONFIG, derive } from "./net.js";

function pairTest(deltaT, cfg) {
  // deltaT > 0 : spike ARRIVES at post before post fires  -> potentiation
  // deltaT < 0 : post fires first, spike arrives after    -> depression
  const net = new Network(cfg);
  const d = net.d;

  // Isolate a single plastic synapse and silence everything else.
  const s = net.synapses.find((x) => x.plastic);
  for (const n of net.neurons) n.nextNoise = Infinity;
  for (const syn of net.synapses) if (syn !== s) syn.weight = 0;
  const w0 = (s.weight = 0.3);

  const pre = s.pre;
  const post = s.post;
  // Lead-in so the postsynaptic spike still lands inside the simulation when it
  // has to precede the presynaptic one by more than the axonal delay.
  const leadIn = 500;
  const preFireStep = leadIn;
  const arrivalStep = leadIn + s.delaySteps;
  const postFireStep = arrivalStep + Math.round(deltaT / d.dt);
  if (postFireStep < 0) throw new Error("lead-in too short for deltaT " + deltaT);
  const totalSteps = Math.max(arrivalStep, postFireStep) + 5;

  for (let i = 0; i < totalSteps; i++) {
    if (i === preFireStep) pre.v = cfg.threshold + 1;
    if (i === postFireStep) post.v = cfg.threshold + 1;
    net.step();
  }
  return s.weight - w0;
}

const cfg = {
  ...DEFAULT_CONFIG,
  numNeurons: 30,
  numNeighbors: 2,
  inhFraction: 0,
  thetaGain: 0,
  lateralInhibition: 0,
  softBounds: false,
  noiseRateT: 0,
  stepsPerT: 400,
};
const d = derive(cfg);

console.log("STDP window, measured against analytic prediction");
console.log(`aPlus ${cfg.aPlus}  aMinus ${(cfg.aPlus * cfg.aMinusRatio).toFixed(4)}`);
console.log(`tauPlus ${d.tauPlus.toFixed(4)}s  tauMinus ${d.tauMinus.toFixed(4)}s\n`);
console.log("  dt/tau     measured      analytic     ratio");

let worst = 0;
for (const k of [0.1, 0.25, 0.5, 1.0, 2.0, 3.0]) {
  for (const sign of [1, -1]) {
    const deltaT = sign * k * (sign > 0 ? d.tauPlus : d.tauMinus);
    const measured = pairTest(deltaT, cfg);
    const analytic =
      sign > 0
        ? cfg.aPlus * Math.exp(-k)
        : -cfg.aPlus * cfg.aMinusRatio * Math.exp(-k);
    const ratio = analytic !== 0 ? measured / analytic : 0;
    worst = Math.max(worst, Math.abs(ratio - 1));
    console.log(
      `${(sign * k).toFixed(2).padStart(8)}  ${measured.toFixed(6).padStart(11)}  ` +
        `${analytic.toFixed(6).padStart(12)}  ${ratio.toFixed(3).padStart(8)}`
    );
  }
}

console.log(`\nworst relative error: ${(100 * worst).toFixed(1)}%`);
console.log(worst < 0.15 ? "PASS - STDP curve is correct" : "FAIL - STDP does not match the analytic curve");

// Second check: the causal ordering must actually depend on the axonal delay.
console.log("\n\nDoes axonal delay determine the sign of the weight change?");
console.log("Post fires at a fixed time; the synapse's delay decides whether the");
console.log("presynaptic spike arrives before (potentiate) or after (depress).\n");
console.log("  delay/T   arrival vs post fire     weight change");
for (const deltaT of [0.30, 0.10, 0.02, -0.02, -0.10, -0.30]) {
  const dw = pairTest(deltaT * cfg.T, cfg);
  const rel = deltaT > 0 ? "arrives before" : "arrives after ";
  console.log(
    `${deltaT.toFixed(2).padStart(9)}   ${rel}         ${dw >= 0 ? "+" : ""}${dw.toFixed(6)}`
  );
}
