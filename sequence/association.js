// The cleanest possible test of what was learned.
//
// After training, drive ONE character's assembly in isolation and watch what
// the rest of the network does over the following two character intervals. If
// the association A -> B formed and is strong enough to drive, assembly B
// should show a spike peak at t = T. Everything else should stay quiet.
//
// This separates two failures that look identical in a recall score: the
// association never formed, versus it formed but cannot sustain a chain.

import { DEFAULT_CONFIG, Network, uniqueCharacters, train, weightSelectivity } from "./net.js";

const SEQ = process.argv[2] || "ABCDEFG";
const overrides = JSON.parse(process.argv[3] || "{}");
const presentations = Number(process.argv[4] || 200);

const cfg = { ...DEFAULT_CONFIG, softBounds: false, ...overrides };
const chars = uniqueCharacters(SEQ);
const net = new Network(cfg);
net.assignAssemblies(chars, cfg.assemblySize);
train(net, SEQ, { presentations });

const sel = weightSelectivity(net, SEQ + SEQ[0]);
console.log(`sequence ${SEQ}, ${presentations} presentations`);
console.log(
  `selectivity ${sel.selectivity.toFixed(2)}  ` +
    `transition w ${sel.transitionInWindow.mean.toFixed(3)} (${(100 * sel.transitionInWindow.fracAtMax).toFixed(0)}% at max)  ` +
    `other w ${sel.otherInWindow.mean.toFixed(3)}`
);

// How much charge can the learned pathway actually deliver? For each pair of
// assemblies, find the best-connected target cell and sum its in-window weights.
const windowLo = cfg.T - cfg.stdpCutoffTaus * cfg.tauPlusT * cfg.T;
function bestDrive(a, b) {
  const sums = new Map();
  for (const pre of net.assemblies[a]) {
    for (const s of pre.out) {
      if (s.weight <= 0 || s.post.assembly !== b) continue;
      if (s.delay > windowLo && s.delay <= cfg.T) {
        sums.set(s.post, (sums.get(s.post) || 0) + s.weight);
      }
    }
  }
  return sums.size ? Math.max(...sums.values()) : 0;
}

console.log(`\nCharge the learned pathway can deliver to its best target cell.`);
console.log(`Threshold is ${cfg.threshold}; anything below that cannot fire the cell.\n`);
console.log("  from -> to      summed in-window weight     enough to fire?");
for (let i = 0; i < SEQ.length; i++) {
  const a = chars.indexOf(SEQ[i]);
  const b = chars.indexOf(SEQ[(i + 1) % SEQ.length]);
  if (a === b) continue;
  const drive = bestDrive(a, b);
  console.log(
    `  ${chars[a]} -> ${chars[b]}            ${drive.toFixed(3).padStart(10)}                ` +
      (drive >= cfg.threshold ? "yes" : "no")
  );
}

// Impulse response, for every transition in turn: quieten the network, fire one
// assembly, and see whether the correct successor responds at t = T.
function impulse(fromChar, toChar) {
  net.learning = false;
  net.resetActivity();
  for (const n of net.neurons) n.nextNoise = Infinity; // silence the background
  for (const n of net.neurons) n.theta = 0; // isolate the pathway from homeostasis

  const from = chars.indexOf(fromChar);
  const to = chars.indexOf(toChar);
  net.driveAssembly(from, cfg.driveStart);

  const bins = 15;
  const perBin = Math.floor(cfg.stepsPerT / 10);
  const grid = chars.map(() => new Array(bins).fill(0));
  let drivenCount = 0;
  for (let b = 0; b < bins; b++) {
    for (let s = 0; s < perBin; s++) {
      net.step();
      for (const n of net.spikesThisStep) {
        if (n.assembly >= 0) grid[n.assembly][b]++;
        if (b === 0 && n.assembly === from) drivenCount++;
      }
    }
  }
  const near = (row) => row.slice(8, 12).reduce((a, b) => a + b, 0);
  const correct = near(grid[to]);
  const other = grid.reduce((s, row, c) => (c === to || c === from ? s : s + near(row)), 0);
  return { drivenCount, correct, other, grid };
}

console.log(`\n\nImpulse response for each transition, background silenced.`);
console.log(`"fired" is how many of the ${cfg.assemblySize} driven cells actually spiked.`);
console.log(`"correct" / "other" count spikes near t = T.\n`);
console.log("  transition   fired   charge   correct   other   propagated?");
let propagated = 0;
let tested = 0;
for (let i = 0; i < SEQ.length; i++) {
  const fromChar = SEQ[i];
  const toChar = SEQ[(i + 1) % SEQ.length];
  if (fromChar === toChar) continue;
  tested++;
  const a = chars.indexOf(fromChar);
  const b = chars.indexOf(toChar);
  const r = impulse(fromChar, toChar);
  const ok = r.correct > 0 && r.correct >= r.other;
  if (ok) propagated++;
  console.log(
    `  ${fromChar} -> ${toChar}       ${String(r.drivenCount).padStart(5)}   ` +
      `${bestDrive(a, b).toFixed(3).padStart(6)}   ${String(r.correct).padStart(7)}   ` +
      `${String(r.other).padStart(5)}   ${ok ? "yes" : "no"}`
  );
}
console.log(`\n${propagated} of ${tested} transitions propagate on their own.`);
