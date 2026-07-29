// How big and how densely connected does the network have to be before STDP has
// anything to work with? Purely structural - no dynamics, no learning.
//
// A cell in assembly B can only be recruited by assembly A if it already
// receives `needed` synapses from A whose axonal delays land in the STDP
// potentiation window. Learning selects among existing delays; it cannot invent
// them. If this number is below 1, no amount of hyperparameter tuning helps.

import { DEFAULT_CONFIG, Network, analyzeConvergence, uniqueCharacters } from "./net.js";

const TUNE = "EEFGGFEDCCDEEDDEEFGGFEDCCDEDCC";
const CHARS = uniqueCharacters(TUNE);

function probe(overrides, hops) {
  const cfg = { ...DEFAULT_CONFIG, ...overrides };
  let acc = { meanBestFanIn: 0, meanDrivableCells: 0, pairsCovered: 0, needed: 0 };
  const trials = 3;
  for (let s = 0; s < trials; s++) {
    const net = new Network({ ...cfg, seed: 100 + s });
    net.assignAssemblies(CHARS, cfg.assemblySize);
    const r = analyzeConvergence(net, { hops });
    acc.meanBestFanIn += r.meanBestFanIn / trials;
    acc.meanDrivableCells += r.meanDrivableCells / trials;
    acc.pairsCovered += r.pairsCovered / trials;
    acc.needed = r.needed;
  }
  return acc;
}

console.log("Structural feasibility of one-character-ahead association.");
console.log(`Sequence has ${CHARS.length} distinct characters.`);
console.log(`"needed" = simultaneous max-weight inputs required to reach threshold.`);
console.log(`"best fan-in" = most in-window synapses any single target cell receives from a source assembly.`);
console.log(`"drivable" = how many cells of the target assembly could actually be recruited.\n`);

const table = [];
for (const numNeurons of [100, 200, 400, 800]) {
  for (const numNeighbors of [8, 16, 32, 64]) {
    for (const assemblySize of [10, 20, 40]) {
      if (assemblySize * CHARS.length > numNeurons * 0.8) continue;
      const r = probe({ numNeurons, numNeighbors, assemblySize }, 1);
      table.push({ numNeurons, numNeighbors, assemblySize, ...r });
    }
  }
}

console.log("1-HOP paths only");
console.log("  N    K   k   needed  best fan-in  drivable cells  pairs covered");
for (const r of table) {
  const flag = r.meanDrivableCells >= 2 ? "  <-- viable" : "";
  console.log(
    `${String(r.numNeurons).padStart(4)} ${String(r.numNeighbors).padStart(4)} ${String(r.assemblySize).padStart(3)}` +
      `   ${String(r.needed).padStart(4)}   ${r.meanBestFanIn.toFixed(2).padStart(10)}   ` +
      `${r.meanDrivableCells.toFixed(2).padStart(13)}   ${(100 * r.pairsCovered).toFixed(0).padStart(11)}%${flag}`
  );
}

console.log("\n\n1-HOP + 2-HOP paths (polychronous routes through intermediate cells)");
console.log("  N    K   k   needed  best fan-in  drivable cells  pairs covered");
for (const numNeurons of [100, 200, 400]) {
  for (const numNeighbors of [8, 16, 32]) {
    for (const assemblySize of [10, 20]) {
      if (assemblySize * CHARS.length > numNeurons * 0.8) continue;
      const r = probe({ numNeurons, numNeighbors, assemblySize }, 2);
      const flag = r.meanDrivableCells >= 2 ? "  <-- viable" : "";
      console.log(
        `${String(numNeurons).padStart(4)} ${String(numNeighbors).padStart(4)} ${String(assemblySize).padStart(3)}` +
          `   ${String(r.needed).padStart(4)}   ${r.meanBestFanIn.toFixed(2).padStart(10)}   ` +
          `${r.meanDrivableCells.toFixed(2).padStart(13)}   ${(100 * r.pairsCovered).toFixed(0).padStart(11)}%${flag}`
      );
    }
  }
}

console.log("\n\nEffect of wMax (how many coincident inputs are needed) at N=400, K=32, k=20:");
for (const wMax of [0.2, 0.35, 0.5, 0.7, 1.0]) {
  const r = probe({ numNeurons: 400, numNeighbors: 32, assemblySize: 20, wMax }, 1);
  console.log(
    `  wMax ${wMax.toFixed(2)} -> needs ${r.needed} coincident inputs, ` +
      `best fan-in ${r.meanBestFanIn.toFixed(2)}, drivable ${r.meanDrivableCells.toFixed(2)} cells, ` +
      `${(100 * r.pairsCovered).toFixed(0)}% of pairs covered`
  );
}

console.log("\n\nEffect of velocityT (delay spread) at N=400, K=32, k=20, wMax=0.5:");
for (const velocityT of [1.0, 1.5, 2.0, 3.0, 4.0]) {
  const r = probe({ numNeurons: 400, numNeighbors: 32, assemblySize: 20, wMax: 0.5, velocityT }, 1);
  const net = new Network({ ...DEFAULT_CONFIG, numNeurons: 400, numNeighbors: 32, velocityT });
  const s = net.stats();
  console.log(
    `  velocityT ${velocityT.toFixed(1)} -> delays ${s.delayMinT.toFixed(2)}T..${s.delayMaxT.toFixed(2)}T, ` +
      `best fan-in ${r.meanBestFanIn.toFixed(2)}, drivable ${r.meanDrivableCells.toFixed(2)} cells`
  );
}
