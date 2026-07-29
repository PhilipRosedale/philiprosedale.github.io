// End-to-end check of the current default configuration.

import {
  DEFAULT_CONFIG,
  Network,
  derive,
  uniqueCharacters,
  firstOrderCeiling,
  chanceLevel,
  train,
  recall,
  weightSelectivity,
  measurePropagation,
  analyzeConvergence,
} from "./net.js";

const SIMPLE = "ABCDEFG";
const TUNE = "EEFGGFEDCCDEEDDEEFGGFEDCCDEDCC";
const PRESENTATIONS = Number(process.argv[2] || 600);

function banner(s) {
  console.log("\n" + "=".repeat(74));
  console.log(s);
  console.log("=".repeat(74));
}

banner("Derived parameters (times as multiples of the character interval T)");
{
  const cfg = DEFAULT_CONFIG;
  const d = derive(cfg);
  const net = new Network(cfg);
  const s = net.stats();
  console.log(`T                              ${cfg.T} s per character`);
  console.log(`axon velocity                  ${d.velocity.toFixed(0)} px/s  (velocityT ${cfg.velocityT})`);
  console.log(`axonal delay range             ${s.delayMinT.toFixed(2)} T .. ${s.delayMaxT.toFixed(2)} T`);
  console.log(`membrane tau                   ${cfg.tauMembraneT} T`);
  console.log(`refractory period              ${cfg.refractoryT} T   (ceiling ${(1 / d.refractory).toFixed(2)} Hz)`);
  console.log(`STDP tau+ / tau-               ${cfg.tauPlusT} T / ${cfg.tauMinusT} T`);
  console.log(`A- / A+                        ${cfg.aMinusRatio}   (depression dominant)`);
  console.log(`bounds                         ${cfg.softBounds ? "soft" : "hard"}`);
  console.log(`neurons / neighbours           ${net.neurons.length} / ${cfg.numNeighbors}`);
  console.log(`assembly size                  ${cfg.assemblySize}  (coding density ${(cfg.assemblySize / cfg.numNeurons).toFixed(2)})`);
  const ballRadius = Math.sqrt((cfg.numNeighbors * cfg.areaPerNeuron) / Math.PI);
  const rStar = cfg.velocityT * cfg.minSpacing;
  console.log(`delay-matched shell r* = v*T   ${rStar.toFixed(0)} px`);
  console.log(`K-nearest ball radius          ${ballRadius.toFixed(0)} px  ${ballRadius >= rStar ? "(covers the shell)" : "(TOO SMALL - those synapses do not exist)"}`);
}

for (const [name, seq] of [["unambiguous", SIMPLE], ["ambiguous tune", TUNE]]) {
  banner(`Learning ${name} sequence: ${seq}`);
  const cfg = DEFAULT_CONFIG;
  const net = new Network(cfg);
  net.assignAssemblies(uniqueCharacters(seq), cfg.assemblySize);
  const structure = analyzeConvergence(net, { hops: 1 });
  console.log(`structural capacity: ${structure.meanDrivableCells.toFixed(1)} cells per transition could be recruited`);
  console.log(`training on ${PRESENTATIONS} presentations...`);

  train(net, seq, { presentations: PRESENTATIONS });
  const sel = weightSelectivity(net, seq + seq[0]);
  const prop = measurePropagation(net, seq);
  const recallSeq = seq.repeat(Math.ceil(30 / seq.length));
  // Scan the replay tempo rather than assuming it: free replay of an
  // STDP-trained sequence is compressed, and the readout clock must match.
  let best = { accuracy: -1 };
  let bestTempo = 1;
  for (let tempoScale = 0.7; tempoScale <= 1.101; tempoScale += 0.025) {
    const r = recall(net, recallSeq, { seedChars: 3, tempoScale });
    if (r.accuracy > best.accuracy) {
      best = r;
      bestTempo = tempoScale;
    }
  }
  const r = best;
  const atNominal = recall(net, recallSeq, { seedChars: 3, tempoScale: 1.0 });

  console.log(`\nWHAT WAS LEARNED`);
  console.log(`  sequence synapses           ${sel.transitionInWindow.mean.toFixed(3)}  (${(100 * sel.transitionInWindow.fracAtMax).toFixed(0)}% at ceiling, n=${sel.transitionInWindow.n})`);
  console.log(`  same delay, no sequence role ${sel.otherInWindow.mean.toFixed(3)}  (n=${sel.otherInWindow.n})`);
  console.log(`  selectivity                 ${sel.selectivity.toFixed(2)}x   (1.0 would mean nothing was learned)`);

  console.log(`\nDOES IT PROPAGATE`);
  console.log(`  single-step propagation     ${(100 * prop.propagationFraction).toFixed(0)}% of transitions`);
  console.log(`  gain (spikes out / spikes in) ${prop.meanGain.toFixed(2)}   (a chain needs >= 1.0 to sustain)`);

  console.log(`\nFREE-RUNNING RECALL`);
  console.log(`  chance                      ${(100 * chanceLevel(seq)).toFixed(0)}%`);
  console.log(`  first-order ceiling         ${(100 * firstOrderCeiling(seq)).toFixed(0)}%`);
  console.log(`  accuracy at nominal tempo   ${(100 * atNominal.accuracy).toFixed(0)}%`);
  console.log(`  replay tempo                ${bestTempo.toFixed(3)} T per character (compressed replay)`);
  console.log(`  accuracy at replay tempo    ${(100 * r.accuracy).toFixed(0)}%`);
  console.log(`  longest correct run         ${r.runLength}`);
  console.log(`  predicted: ${r.predictions.slice(0, 40).map((p) => p.predicted ?? ".").join("")}`);
  console.log(`  expected : ${r.predictions.slice(0, 40).map((p) => p.expected).join("")}`);
}
