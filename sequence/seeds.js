// Robustness check: is the operating point real, or is it a lucky geometry?
//
// Every sweep in this harness scored one network per configuration. Neuron
// placement, the excitatory/inhibitory split and the assembly assignment are
// all drawn from the seed, so a single sample cannot distinguish a good
// parameter set from a fortunate layout. This re-runs the chosen configuration
// across independent seeds and reports the spread.

import { runTasks } from "./sweep.js";
import { chanceLevel, firstOrderCeiling } from "./net.js";

const SIMPLE = "ABCDEFG";
const TUNE = "EEFGGFEDCCDEEDDEEFGGFEDCCDEDCC";
const SEEDS = 8;
const PRESENTATIONS = 400;

function stats(xs) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { mean, sd, min: Math.min(...xs), max: Math.max(...xs) };
}

for (const [name, sequence] of [["unambiguous ABCDEFG", SIMPLE], ["ambiguous tune", TUNE]]) {
  const specs = [];
  for (let s = 0; s < SEEDS; s++) {
    specs.push({
      label: `seed ${s + 1}`,
      spec: { overrides: { seed: 1 + s * 977 }, sequence, presentations: PRESENTATIONS, seeds: 1 },
    });
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log(`${name}: ${SEEDS} independent networks, ${PRESENTATIONS} presentations each`);
  console.log("=".repeat(78));
  const results = await runTasks(specs);

  console.log("\n  seed   selectivity   propagation   gain   tempo   accuracy   longest run");
  results.forEach((r, i) => {
    console.log(
      `  ${String(i + 1).padStart(4)}   ${r.selectivity.toFixed(2).padStart(11)}   ` +
        `${((100 * r.propagation).toFixed(0) + "%").padStart(11)}   ${r.gain.toFixed(2).padStart(4)}   ` +
        `${r.tempo.toFixed(2).padStart(5)}   ${((100 * r.accuracy).toFixed(0) + "%").padStart(8)}   ` +
        `${r.runLength.toFixed(0).padStart(11)}`
    );
  });

  const chance = chanceLevel(sequence);
  const ceiling = firstOrderCeiling(sequence);
  const acc = stats(results.map((r) => r.accuracy));
  const sel = stats(results.map((r) => r.selectivity));
  const prop = stats(results.map((r) => r.propagation));
  const run = stats(results.map((r) => r.runLength));

  console.log(`\n  selectivity   ${sel.mean.toFixed(2)} +/- ${sel.sd.toFixed(2)}   (range ${sel.min.toFixed(2)} to ${sel.max.toFixed(2)})`);
  console.log(`  propagation   ${(100 * prop.mean).toFixed(0)}% +/- ${(100 * prop.sd).toFixed(0)}%   (range ${(100 * prop.min).toFixed(0)}% to ${(100 * prop.max).toFixed(0)}%)`);
  console.log(`  accuracy      ${(100 * acc.mean).toFixed(0)}% +/- ${(100 * acc.sd).toFixed(0)}%   (range ${(100 * acc.min).toFixed(0)}% to ${(100 * acc.max).toFixed(0)}%)`);
  console.log(`  longest run   ${run.mean.toFixed(1)} +/- ${run.sd.toFixed(1)}   (max ${run.max.toFixed(0)})`);
  console.log(`\n  chance ${(100 * chance).toFixed(0)}%, first-order ceiling ${(100 * ceiling).toFixed(0)}%`);

  // Is the mean accuracy distinguishable from chance given the spread?
  const sem = acc.sd / Math.sqrt(SEEDS);
  const z = sem > 0 ? (acc.mean - chance) / sem : 0;
  console.log(
    `  accuracy is ${(100 * (acc.mean - chance)).toFixed(0)} points above chance, ` +
      `${z.toFixed(1)} standard errors ` +
      (z > 3 ? "- clearly real" : z > 2 ? "- probably real" : "- NOT distinguishable from chance")
  );
}
