// Hypothesis: the synapses that can ever participate in learning a T-second
// transition are not "the nearest K" but the ones lying in a DISTANCE SHELL of
// radius r* = v*T, thickness dr = v * (STDP window). Everything else is either
// too fast or too slow to land in the potentiation window, whatever its weight.
//
// Two consequences follow, and both are testable:
//   1. numNeighbors only matters up to the point where the K-nearest ball
//      contains the shell. Beyond that it adds nothing.
//   2. Expected in-window fan-in from an assembly of k cells out of N is
//         (k/N) * (2*pi*r* * dr) / areaPerNeuron
//      so it grows LINEARLY with velocity, and depends on coding density k/N
//      rather than on assembly size alone.

import { DEFAULT_CONFIG, Network, analyzeConvergence, uniqueCharacters } from "./net.js";

const CHARS = uniqueCharacters("EEFGGFEDCCDEEDDEEFGGFEDCCDEDCC");

function predictedFanIn(cfg) {
  const rStar = cfg.velocityT * cfg.minSpacing; // v * T in pixels
  const dr = rStar * cfg.stdpCutoffTaus * cfg.tauPlusT; // v * window
  const shellArea = 2 * Math.PI * rStar * dr;
  const inShell = shellArea / cfg.areaPerNeuron;
  const ballRadius = Math.sqrt((cfg.numNeighbors * cfg.areaPerNeuron) / Math.PI);
  const codingDensity = cfg.assemblySize / cfg.numNeurons;
  return {
    rStar,
    dr,
    ballRadius,
    shellCovered: ballRadius >= rStar,
    predicted: inShell * codingDensity * (ballRadius >= rStar ? 1 : 0),
  };
}

function measure(overrides, hops = 1, trials = 3) {
  const cfg = { ...DEFAULT_CONFIG, ...overrides };
  let best = 0;
  let drivable = 0;
  for (let s = 0; s < trials; s++) {
    const net = new Network({ ...cfg, seed: 200 + s });
    net.assignAssemblies(CHARS, cfg.assemblySize);
    const r = analyzeConvergence(net, { hops });
    best += r.meanBestFanIn / trials;
    drivable += r.meanDrivableCells / trials;
  }
  return { best, drivable };
}

const BASE = { numNeurons: 400, assemblySize: 40, wMax: 0.5 };

console.log("Prediction 1: numNeighbors stops mattering once the K-nearest ball");
console.log("contains the delay-matched shell at r* = v*T.\n");
console.log("velT  r*(px)  ball radius by K ->      K=8     K=16     K=24     K=32     K=48");
for (const velocityT of [2, 3, 4, 5, 6]) {
  const row = [];
  for (const numNeighbors of [8, 16, 24, 32, 48]) {
    const cfg = { ...DEFAULT_CONFIG, ...BASE, velocityT, numNeighbors };
    const p = predictedFanIn(cfg);
    const m = measure({ ...BASE, velocityT, numNeighbors }, 1);
    row.push(`${m.best.toFixed(2)}${p.shellCovered ? " " : "*"}`);
  }
  const p0 = predictedFanIn({ ...DEFAULT_CONFIG, ...BASE, velocityT, numNeighbors: 8 });
  console.log(
    `${String(velocityT).padStart(4)}  ${p0.rStar.toFixed(0).padStart(6)}` +
      `                        ` + row.map((r) => r.padStart(8)).join(" ")
  );
}
console.log("(* = the K-nearest ball does not reach the shell; those synapses do not exist)");

console.log("\n\nPrediction 2: in-window fan-in grows linearly with velocity and with");
console.log("coding density k/N. K is fixed at 48 so the shell is always covered.\n");
console.log("velT   k/N     predicted  measured  drivable cells");
for (const velocityT of [2, 3, 4, 5, 6]) {
  for (const [numNeurons, assemblySize] of [[400, 20], [400, 40], [400, 60]]) {
    const cfg = { ...DEFAULT_CONFIG, ...BASE, numNeurons, assemblySize, velocityT, numNeighbors: 48 };
    const p = predictedFanIn(cfg);
    const m = measure({ ...BASE, numNeurons, assemblySize, velocityT, numNeighbors: 48 }, 1);
    console.log(
      `${String(velocityT).padStart(4)}  ${(assemblySize / numNeurons).toFixed(2).padStart(5)}` +
        `   ${p.predicted.toFixed(2).padStart(9)}  ${m.best.toFixed(2).padStart(8)}  ${m.drivable.toFixed(2).padStart(14)}`
    );
  }
}

console.log("\n\nDoes adding 2-hop (polychronous) routes help once delays are short enough?\n");
console.log("velT   1-hop drivable   1+2-hop drivable");
for (const velocityT of [2, 3, 4, 5, 6]) {
  const one = measure({ ...BASE, velocityT, numNeighbors: 24 }, 1);
  const two = measure({ ...BASE, velocityT, numNeighbors: 24 }, 2);
  console.log(
    `${String(velocityT).padStart(4)}   ${one.drivable.toFixed(2).padStart(13)}   ${two.drivable.toFixed(2).padStart(16)}`
  );
}
