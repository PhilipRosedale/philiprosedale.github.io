// Named parameter sweeps.  node sweeps.js <name>

import { runTasks, printTable, COLUMNS } from "./sweep.js";

const SIMPLE = "ABCDEFG";
const TUNE = "EEFGGFEDCCDEEDDEEFGGFEDCCDEDCC";

const BASE = {};

function spec(label, overrides, sequence = SIMPLE, presentations = 150, seeds = 1) {
  return { label, spec: { overrides: { ...BASE, ...overrides }, sequence, presentations, seeds } };
}

const SWEEPS = {
  // Hypothesis: chance spike pairings from background activity swamp the one
  // sequence-driven pairing per presentation. Quieting the network and
  // strengthening LTD should both raise selectivity.
  async noise() {
    const specs = [];
    for (const targetRateT of [0.1, 0.15, 0.25, 0.4, 0.8]) {
      for (const aMinusRatio of [1.0, 1.5, 2.0, 3.0, 4.0]) {
        specs.push(
          spec(`rate ${targetRateT}, A-/A+ ${aMinusRatio}`, { targetRateT, aMinusRatio })
        );
      }
    }
    const results = await runTasks(specs);
    printTable(specs, results, COLUMNS, "selectivity");
  },

  // The STDP window trades off tolerance to delay mismatch against the number
  // of chance pairings it admits.
  async window() {
    const specs = [];
    for (const tauPlusT of [0.04, 0.08, 0.12, 0.2, 0.3]) {
      for (const targetRateT of [0.15, 0.3]) {
        for (const aMinusRatio of [1.2, 2.0]) {
          specs.push(
            spec(`tau+ ${tauPlusT}T, rate ${targetRateT}, A-/A+ ${aMinusRatio}`, {
              tauPlusT,
              tauMinusT: tauPlusT * 1.15,
              targetRateT,
              aMinusRatio,
            })
          );
        }
      }
    }
    const results = await runTasks(specs);
    printTable(specs, results, COLUMNS, "selectivity");
  },

  // Learning rate against number of presentations: small steps averaged over
  // many repetitions should let the consistent sequence correlation win over
  // the inconsistent background one.
  async rate() {
    const specs = [];
    for (const aPlus of [0.002, 0.005, 0.012, 0.03]) {
      for (const presentations of [80, 200, 500]) {
        specs.push(
          spec(`aPlus ${aPlus}, ${presentations} presentations`, {
            aPlus,
            targetRateT: 0.15,
            aMinusRatio: 1.5,
          }, SIMPLE, presentations)
        );
      }
    }
    const results = await runTasks(specs);
    printTable(specs, results, COLUMNS, "selectivity");
  },

  // Propagation gain: a chain sustains itself only if each step recruits at
  // least as many cells as fired at the previous one. These are the parameters
  // that set the gain.
  async gain() {
    const specs = [];
    for (const assemblySize of [20, 40]) {
      for (const wMax of [0.6, 1.0, 1.5]) {
        for (const velocityT of [4, 5]) {
          for (const tauMembraneT of [0.5, 0.8]) {
            specs.push(
              spec(`k ${assemblySize}, wMax ${wMax}, velT ${velocityT}, tauM ${tauMembraneT}T`, {
                assemblySize,
                wMax,
                velocityT,
                tauMembraneT,
                numNeighbors: 48,
              }, SIMPLE, 200)
            );
          }
        }
      }
    }
    const results = await runTasks(specs);
    printTable(specs, results, COLUMNS, "propagation");
  },

  // Gain is limited by how far the sequence synapses actually climb, not by the
  // ceiling they are allowed to climb to. Raising wMax is useless if only 3% of
  // them get there. Push learning rate and repetitions to drive saturation.
  async saturate() {
    const specs = [];
    for (const wMax of [0.8, 1.5, 2.5]) {
      for (const aPlus of [0.008, 0.03, 0.08]) {
        for (const presentations of [200, 600]) {
          specs.push(
            spec(`wMax ${wMax}, aPlus ${aPlus}, ${presentations} pres`, {
              wMax,
              aPlus,
              assemblySize: 40,
              numNeighbors: 64,
              velocityT: 5,
            }, SIMPLE, presentations)
          );
        }
      }
    }
    const results = await runTasks(specs);
    printTable(specs, results, COLUMNS, "gain");
  },

  // Fan-in scales as velocityT^2 * tauPlusT, while synchrony of the arriving
  // volley depends only on tauPlusT. So velocity buys fan-in for free, and
  // tauPlusT trades fan-in against how well the arrivals sum.
  // numNeighbors must keep the K-nearest ball outside the shell at r* = v*T.
  async shellwidth() {
    const specs = [];
    for (const velocityT of [5, 6, 7, 8]) {
      for (const tauPlusT of [0.06, 0.09, 0.12, 0.18]) {
        const mu = 0.1 * 2 * Math.PI * velocityT ** 2 * 3 * tauPlusT * (45 ** 2 / ((1440 * 900) / 200));
        specs.push(
          spec(`velT ${velocityT}, tau+ ${tauPlusT}T  (mu~${mu.toFixed(1)})`, {
            velocityT,
            tauPlusT,
            tauMinusT: tauPlusT * 1.15,
            numNeighbors: 80,
          }, SIMPLE, 400)
        );
      }
    }
    const results = await runTasks(specs);
    printTable(specs, results, COLUMNS, "gain");
  },

  // Gain is set by how many coincident learned synapses a target cell needs:
  //   gain ~ P(Poisson(mu) >= ceil(threshold / learned weight))
  // At mu=1.8 and a learned weight of 0.72 against threshold 1.0 that needs
  // two, giving 0.54. If one synapse sufficed it would be 1 - exp(-mu) = 0.83.
  // So the lever is the ratio of learned weight to effective threshold.
  async gainpush() {
    const specs = [];
    for (const threshold of [0.5, 0.7, 1.0]) {
      for (const tauMembraneT of [0.5, 0.9]) {
        for (const targetRateT of [0.15, 0.25]) {
          specs.push(
            spec(`thresh ${threshold}, tauM ${tauMembraneT}T, rate ${targetRateT}`, {
              threshold,
              tauMembraneT,
              targetRateT,
              velocityT: 5,
              tauPlusT: 0.12,
              numNeighbors: 80,
            }, SIMPLE, 400)
          );
        }
      }
    }
    const results = await runTasks(specs);
    printTable(specs, results, COLUMNS, "gain");
  },

  // Anneal lateral inhibition: build the pathways with the whole assembly
  // firing, then phase inhibition in to select a context-specific subset.
  async anneal() {
    const specs = [];
    for (const end of [0, 0.1, 0.3, 0.6, 1.0]) {
      for (const velocityT of [6, 8]) {
        specs.push(
          spec(`lateral 0 -> ${end}, velT ${velocityT}`, {
            lateralInhibitionStart: 0,
            lateralInhibitionEnd: end,
            velocityT,
            numNeighbors: 80,
          }, SIMPLE, 400)
        );
      }
    }
    const results = await runTasks(specs);
    printTable(specs, results, COLUMNS, "gain");
  },

  // Once single steps propagate, can the chain sustain itself end to end?
  async chain() {
    const specs = [];
    for (const aMinusRatio of [1.5, 2, 3]) {
      for (const presentations of [200, 400]) {
        for (const wMax of [1.0, 1.5]) {
          specs.push(
            spec(`A-/A+ ${aMinusRatio}, ${presentations} pres, wMax ${wMax}`, {
              aMinusRatio,
              wMax,
              assemblySize: 40,
              numNeighbors: 48,
              velocityT: 4,
            }, SIMPLE, presentations)
          );
        }
      }
    }
    const results = await runTasks(specs);
    printTable(specs, results, COLUMNS, "accuracy");
  },

  // Structure: does more convergence translate into better learning?
  async structure() {
    const specs = [];
    for (const velocityT of [2, 3, 4, 5]) {
      for (const assemblySize of [20, 40]) {
        for (const numNeighbors of [16, 32, 48]) {
          specs.push(
            spec(`velT ${velocityT}, k ${assemblySize}, K ${numNeighbors}`, {
              velocityT,
              assemblySize,
              numNeighbors,
              targetRateT: 0.15,
              aMinusRatio: 1.5,
            })
          );
        }
      }
    }
    const results = await runTasks(specs);
    printTable(specs, results, COLUMNS, "selectivity");
  },
};

const name = process.argv[2];
if (!SWEEPS[name]) {
  console.error(`usage: node sweeps.js <${Object.keys(SWEEPS).join("|")}>`);
  process.exit(1);
}
console.log(`sweep: ${name}\n`);
await SWEEPS[name]();
