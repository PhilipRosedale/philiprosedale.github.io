// Instrumented single run: what actually happens during training?

import { DEFAULT_CONFIG, Network, uniqueCharacters, recall } from "./net.js";

const SEQ = process.argv[2] || "ABCDEFG";
const overrides = JSON.parse(process.argv[3] || "{}");
const presentations = Number(process.argv[4] || 80);

const cfg = { ...DEFAULT_CONFIG, ...overrides };
const chars = uniqueCharacters(SEQ);
const net = new Network(cfg);
net.assignAssemblies(chars, cfg.assemblySize);
const indexOf = new Map(chars.map((c, i) => [c, i]));

console.log(`sequence "${SEQ}", ${chars.length} characters, ${presentations} presentations`);
console.log(`N=${net.neurons.length} K=${cfg.numNeighbors} k=${cfg.assemblySize} ` +
  `velT=${cfg.velocityT} wMax=${cfg.wMax} latInh=${cfg.lateralInhibition} theta=${cfg.thetaGain}`);
console.log(`excitatory neurons: ${net.neurons.filter((n) => !n.inhibitory).length}, ` +
  `assembly cells: ${chars.length * cfg.assemblySize}\n`);

console.log("pres   spikes/char   assembly   other    meanW   maxW   %atMax   %atZero   meanTheta");
for (let p = 0; p < presentations; p++) {
  const progress = presentations > 1 ? p / (presentations - 1) : 1;
  const drive = cfg.driveStart + (cfg.driveEnd - cfg.driveStart) * progress;
  let assemblySpikes = 0;
  let otherSpikes = 0;
  for (let i = 0; i < SEQ.length; i++) {
    net.driveAssembly(indexOf.get(SEQ[i]), drive);
    for (let s = 0; s < cfg.stepsPerT; s++) {
      net.step();
      for (const n of net.spikesThisStep) {
        if (n.assembly >= 0) assemblySpikes++;
        else otherSpikes++;
      }
    }
  }
  if (p % Math.max(1, Math.floor(presentations / 12)) === 0 || p === presentations - 1) {
    const exc = net.synapses.filter((s) => s.plastic).map((s) => s.weight);
    const meanW = exc.reduce((a, b) => a + b, 0) / exc.length;
    const maxW = Math.max(...exc);
    const atMax = exc.filter((w) => w > cfg.wMax * 0.99).length / exc.length;
    const atZero = exc.filter((w) => w < cfg.wMax * 0.02).length / exc.length;
    const meanTheta = net.neurons.reduce((a, n) => a + n.theta, 0) / net.neurons.length;
    console.log(
      String(p).padStart(4) +
        ((assemblySpikes + otherSpikes) / SEQ.length).toFixed(1).padStart(14) +
        assemblySpikes.toString().padStart(11) +
        otherSpikes.toString().padStart(8) +
        meanW.toFixed(4).padStart(9) +
        maxW.toFixed(3).padStart(7) +
        (100 * atMax).toFixed(1).padStart(9) +
        (100 * atZero).toFixed(1).padStart(10) +
        meanTheta.toFixed(3).padStart(12)
    );
  }
}

const r = recall(net, SEQ.repeat(Math.ceil(30 / SEQ.length)), { seedChars: 3 });
console.log(`\nrecall accuracy ${(100 * r.accuracy).toFixed(0)}%, run ${r.runLength}, silent ${(100 * r.silentFraction).toFixed(0)}%`);
console.log(`predicted: ${r.predictions.map((p) => p.predicted ?? ".").join("")}`);
console.log(`expected : ${r.predictions.map((p) => p.expected).join("")}`);
console.log(`spikes/window during recall: ${r.predictions.map((p) => Math.min(9, p.total)).join("")}`);
