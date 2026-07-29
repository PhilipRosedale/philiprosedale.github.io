// Before anything can be learned the network has to be ALIVE: self-sustaining,
// sparse, and irregular. Too quiet and STDP never sees a postsynaptic spike;
// too loud and every spike pairs with every other and the weights randomise.
//
// This maps the operating regime with learning switched OFF, so it measures the
// dynamics alone.

import { DEFAULT_CONFIG, Network, uniqueCharacters } from "./net.js";

const CHARS = uniqueCharacters("EEFGGFEDCCDEEDDEEFGGFEDCCDEDCC");

function rate(overrides, { characters = 150, learning = false } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...overrides };
  const net = new Network(cfg);
  net.assignAssemblies(CHARS, cfg.assemblySize);
  net.learning = learning;
  for (let i = 0; i < characters * cfg.stepsPerT; i++) net.step();
  const s = net.stats();
  return {
    hz: s.meanRateHz,
    perT: s.ratePerT,
    pctCeiling: (100 * s.meanRateHz) / s.refractoryCeilingHz,
    meanW: s.meanWeight,
    atMax: s.fracAtMax,
  };
}

console.log("Spontaneous firing rate, learning OFF, no sequence input.");
console.log("Shown as spikes per neuron per character interval T.");
console.log("Target band is roughly 0.2 - 1.0 (sparse, irregular, self-sustaining).");
console.log("The refractory ceiling is 2.0 per T, so anything near 2 is a seizure.\n");

const wInits = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4];
const noises = [0, 0.01, 0.05, 0.2, 1.0];

console.log("        noiseRateT ->");
process.stdout.write("wInit  ");
for (const n of noises) process.stdout.write(String(n).padStart(9));
console.log();
for (const wInit of wInits) {
  process.stdout.write(String(wInit).padEnd(7));
  for (const noiseRateT of noises) {
    const r = rate({ wInit, noiseRateT, wMax: Math.max(0.5, wInit * 2) });
    process.stdout.write(r.perT.toFixed(2).padStart(9));
  }
  console.log();
}

console.log("\n\nExcitation/inhibition balance, measured at an ACTIVE operating point");
console.log("(wInit=0.4, noise=0.05, homeostasis off so the balance is visible).");
console.log("inhGain * inhFraction = 0.8 is exact balance; above that is inhibition-dominated.\n");
console.log("inhGain  inhFraction  E/I product   rate per T");
for (const inhGain of [0, 2, 3, 4, 5, 6]) {
  for (const inhFraction of [0.2]) {
    const r = rate({ wInit: 0.4, wMax: 0.8, noiseRateT: 0.05, thetaGain: 0, inhGain, inhFraction });
    console.log(
      String(inhGain).padStart(7) + String(inhFraction).padStart(13) +
        (inhGain * inhFraction).toFixed(2).padStart(13) + r.perT.toFixed(2).padStart(13)
    );
  }
}

console.log("\n\nWith the homeostatic threshold ON, does it pull the rate to target");
console.log("regardless of where the weights start? (target = 0.8 spikes per T)\n");
console.log("wInit   thetaGain=0   thetaGain=0.02   thetaGain=0.05   thetaGain=0.15");
for (const wInit of [0.1, 0.2, 0.3, 0.4]) {
  const cells = [];
  for (const thetaGain of [0, 0.02, 0.05, 0.15]) {
    const r = rate({ wInit, noiseRateT: 0.05, thetaGain, wMax: Math.max(0.5, wInit * 2) });
    cells.push(r.perT.toFixed(2).padStart(15));
  }
  console.log(String(wInit).padEnd(7) + cells.join(" "));
}
