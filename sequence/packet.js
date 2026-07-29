// Does a single assembly firing launch a packet that travels?
//
// With the chain allowed to run through intermediate cells, the character
// assemblies stop being mandatory relays and become readouts. What has to be
// true is that a packet of activity survives from one character interval to the
// next without either dying out or blowing up. This shows the packet size over
// several intervals, and how much of it lands in the correct assembly.

import { DEFAULT_CONFIG, Network, uniqueCharacters, train } from "./net.js";

const SEQ = process.argv[2] || "ABCDEFG";
const overrides = JSON.parse(process.argv[3] || "{}");
const presentations = Number(process.argv[4] || 300);

const cfg = { ...DEFAULT_CONFIG, ...overrides };
const chars = uniqueCharacters(SEQ);
const net = new Network(cfg);
net.assignAssemblies(chars, cfg.assemblySize);

console.log(
  `N=${net.neurons.length} K=${cfg.numNeighbors} k=${cfg.assemblySize} velT=${cfg.velocityT} ` +
    `globalInh=${cfg.globalInhibition} tauGI=${cfg.globalInhibitionTauT}T wMax=${cfg.wMax}`
);
console.log(`training on ${presentations} presentations of "${SEQ}"...\n`);
train(net, SEQ, { presentations });

// Drive the first assembly and watch the whole network for four intervals.
net.learning = false;
net.resetActivity();
for (const n of net.neurons) n.nextNoise = Infinity;
net.driveAssembly(chars.indexOf(SEQ[0]), cfg.driveStart);

const intervals = 4;
const binsPerT = 5;
const perBin = Math.floor(cfg.stepsPerT / binsPerT);
const total = [];
const assemblyRows = chars.map(() => []);
for (let b = 0; b < intervals * binsPerT; b++) {
  let all = 0;
  const per = new Array(chars.length).fill(0);
  for (let s = 0; s < perBin; s++) {
    net.step();
    for (const n of net.spikesThisStep) {
      all++;
      if (n.assembly >= 0) per[n.assembly]++;
    }
  }
  total.push(all);
  chars.forEach((_, c) => assemblyRows[c].push(per[c]));
}

const label = (b) => (b / binsPerT).toFixed(1);
process.stdout.write("t/T:      ");
for (let b = 0; b < total.length; b++) process.stdout.write(label(b).padStart(5));
console.log();
process.stdout.write("all cells:");
for (const v of total) process.stdout.write(String(v).padStart(5));
console.log("   <- packet size");
console.log();
for (let c = 0; c < chars.length; c++) {
  const expectedAt = [];
  for (let i = 1; i <= intervals; i++) {
    if (SEQ[i % SEQ.length] === chars[c]) expectedAt.push(i);
  }
  process.stdout.write(`  ${chars[c]}:      `);
  for (const v of assemblyRows[c]) process.stdout.write((v || ".").toString().padStart(5));
  console.log(expectedAt.length ? `   <- expected at t/T = ${expectedAt.join(", ")}` : "");
}

// Replay tempo. STDP can only potentiate synapses whose spike arrives BEFORE
// the postsynaptic cell fires, so every learned delay is shorter than T, and
// the mean sits near T - tauPlus. Free replay therefore runs fast, and the
// error compounds: after n steps the packet is n * (T - learned delay) early.
{
  const peaks = [];
  for (let i = 1; i <= intervals; i++) {
    const want = chars.indexOf(SEQ[i % SEQ.length]);
    const row = assemblyRows[want];
    let bestBin = -1;
    let bestVal = 0;
    const lo = Math.max(0, (i - 1) * binsPerT);
    const hi = Math.min(row.length, (i + 1) * binsPerT);
    for (let b = lo; b < hi; b++) {
      if (row[b] > bestVal) {
        bestVal = row[b];
        bestBin = b;
      }
    }
    if (bestBin >= 0) peaks.push(bestBin / binsPerT);
  }
  if (peaks.length >= 2) {
    const steps = [];
    for (let i = 1; i < peaks.length; i++) steps.push(peaks[i] - peaks[i - 1]);
    const tempo = steps.reduce((a, b) => a + b, 0) / steps.length;
    console.log(`\nreplay tempo: ${tempo.toFixed(2)} T per character (peaks at t/T = ${peaks.join(", ")})`);
    console.log(`  ${tempo < 0.95 ? "running FAST - learned delays sit below T" : tempo > 1.05 ? "running SLOW" : "on tempo"}`);
  }
}

// Score: at each whole interval, is the correct assembly the most active?
console.log("\ninterval   expected   most active   correct?   packet");
let correct = 0;
for (let i = 1; i <= intervals; i++) {
  const b = i * binsPerT;
  const lo = Math.max(0, b - 1);
  const hi = Math.min(total.length, b + 2);
  const sums = chars.map((_, c) => assemblyRows[c].slice(lo, hi).reduce((a, x) => a + x, 0));
  const best = sums.reduce((bi, v, vi) => (v > sums[bi] ? vi : bi), 0);
  const packet = total.slice(lo, hi).reduce((a, x) => a + x, 0);
  const want = SEQ[i % SEQ.length];
  const got = sums[best] > 0 ? chars[best] : "-";
  if (got === want) correct++;
  console.log(
    `${String(i).padStart(8)}   ${want.padStart(8)}   ${got.padStart(11)}   ` +
      `${(got === want ? "yes" : "no").padStart(8)}   ${String(packet).padStart(6)}`
  );
}
console.log(`\n${correct} of ${intervals} intervals recalled correctly from a single seed.`);
