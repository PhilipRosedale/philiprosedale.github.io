// Polychronous sequence-learning spiking network.
//
// Preserves the three defining features of interactiveNeurons.html:
//   * Hebbian STDP on excitatory synapses
//   * an absolute refractory period after each spike
//   * axonal transmission time proportional to the distance between neurons
//
// Everything is expressed as a ratio to a single timescale T, the interval
// between successive characters of the sequence. Changing T rescales the whole
// simulation coherently; the ratios are what determine whether it learns.
//
// Runs headless in Node and in the browser from the same source.

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG = {
  seed: 1,

  // --- the single timescale knob -------------------------------------------
  T: 0.6, // seconds per character
  stepsPerT: 100, // integration resolution; dt = T / stepsPerT

  // --- geometry (pixels, matching the original sketch's canvas) ------------
  // numNeighbors must be large enough that the K-nearest ball reaches the
  // delay-matched shell at radius v*T, otherwise the synapses that could carry
  // a one-character transition simply do not exist. See shell.js.
  numNeurons: 400,
  numNeighbors: 80,
  minSpacing: 45,
  // Canvas defaults to whatever area holds the neuron density constant at the
  // original sketch's value (200 neurons in 1440x900). Holding density fixed is
  // what makes a sweep over numNeurons fair: the local neighbourhood radius,
  // and therefore the axonal delay distribution, stays comparable.
  areaPerNeuron: (1440 * 900) / 200,
  aspect: 1440 / 900,
  width: null, // derived from areaPerNeuron unless set explicitly
  height: null,

  // --- timescale ratios (dimensionless; these are the real hyperparameters) -
  // Axon velocity is set so the SHORTEST possible axon takes T / velocityT
  // seconds. velocityT = 2 puts the shortest delay at T/2 and, given the
  // nearest-neighbour distance spread, the longest around 3T. That range is
  // what lets one neuron receive "one character ago" and "two characters ago"
  // simultaneously, which is the substrate for context sensitivity.
  velocityT: 6.0,
  // The membrane time constant has to be at least as wide as the spread of
  // arrival times inside the STDP window, or the delayed inputs never sum.
  tauMembraneT: 0.5, // membrane time constant / T
  refractoryT: 0.5, // absolute refractory period / T
  tauPlusT: 0.12, // STDP potentiation time constant / T
  tauMinusT: 0.14, // STDP depression time constant / T
  stdpCutoffTaus: 3.0, // ignore pairings beyond this many time constants

  // --- neurons --------------------------------------------------------------
  threshold: 1.0,
  vMin: -1.0, // floor on membrane potential (hyperpolarisation limit)
  inhFraction: 0.2,

  // --- synapses -------------------------------------------------------------
  // wMax sets how many simultaneous inputs it takes to reach threshold, which
  // is the network's coincidence-detection requirement. wMax = 0.5 means two.
  wInit: 0.25, // mean initial excitatory weight
  wMax: 2.5,
  inhGain: 4.0, // inhibitory weights are this much stronger than excitatory

  // --- STDP -----------------------------------------------------------------
  aPlus: 0.008,
  // Depression must dominate potentiation or every synapse drifts to the same
  // value and nothing is selective. Higher ratios sharpen selectivity but also
  // erode the sequence synapses, so it trades against propagation gain.
  aMinusRatio: 3.0,
  // Hard bounds. Soft (multiplicative) bounds pull every weight to the same
  // equilibrium w_max * A+/(A+ + A-), giving a narrow unimodal distribution
  // with no structure. Hard bounds let the distribution split.
  softBounds: false,

  // --- homeostasis ----------------------------------------------------------
  // Adaptive threshold: theta rises on each spike and falls continuously, so it
  // settles where the neuron's rate equals the target. It must be allowed to go
  // NEGATIVE, otherwise a silent neuron can never become more excitable and the
  // network has no way back from the dead regime. Set thetaGain = 0 to disable
  // and study pure STDP.
  thetaGain: 0.05,
  // Must sit at or above the rate the sequence itself imposes on an assembly
  // cell (occurrences of its character divided by sequence length, per T),
  // otherwise homeostasis fights the teaching signal and suppresses it.
  targetRateT: 0.25, // target spikes per neuron per T
  thetaMin: -0.6, // floor on the adaptive threshold offset
  thetaMax: 2.0,

  // --- global inhibition ----------------------------------------------------
  // Fast network-wide feedback inhibition, the cortical basket-cell motif. Every
  // spike briefly raises the firing threshold everywhere, which holds the
  // travelling packet at a roughly constant size.
  //
  // This is what makes it possible to let the chain run through intermediate
  // cells instead of forcing the character assembly to re-form at every step.
  // Recruiting whichever of the ~320 excitatory neurons happen to be delay
  // matched, rather than 40 specified ones, gives far more than unity gain, so
  // the problem becomes holding the packet down rather than keeping it alive.
  globalInhibition: 0.0075, // threshold rise per spike, as a fraction of threshold
  globalInhibitionTauT: 0.15, // decay time constant / T

  // --- background activity --------------------------------------------------
  // A suprathreshold kick delivered to random neurons, as in Izhikevich's
  // polychronization model. Without it the network is a dead lattice: weights
  // can only grow where the postsynaptic cell fires, and nothing fires.
  noiseRateT: 0.05, // kicks per neuron per T
  noiseAmp: 1.0,

  // --- input representation -------------------------------------------------
  // What matters structurally is the coding density assemblySize / numNeurons,
  // not the assembly size on its own.
  assemblySize: 40, // neurons per character
  // Each spike subtracts this from the rest of its assembly, so roughly
  // (drive - threshold) / lateralInhibition + 1 cells win per presentation.
  //
  // This is the context mechanism, and it is in direct tension with
  // propagation: the number of cells that fire is exactly what drives the next
  // step, so any sparsening costs gain. It is therefore annealed - training
  // starts with the whole assembly firing so the pathways can form at all, and
  // inhibition is phased in once they exist, to select the context-appropriate
  // subset. Leave start and end equal for a fixed value.
  lateralInhibition: 0, // fallback when the annealed pair is unset
  lateralInhibitionStart: 0,
  lateralInhibitionEnd: 0,

  // --- teaching drive -------------------------------------------------------
  // Annealed from supra- to sub-threshold: early on the input forces the whole
  // assembly to fire so there is something to learn from; later it only
  // depolarises, so a cell fires only if the network also predicted it.
  driveStart: 1.6,
  driveEnd: 1.6,
};

export function derive(cfg) {
  const dt = cfg.T / cfg.stepsPerT;
  return {
    dt,
    tauMembrane: cfg.tauMembraneT * cfg.T,
    refractory: cfg.refractoryT * cfg.T,
    tauPlus: cfg.tauPlusT * cfg.T,
    tauMinus: cfg.tauMinusT * cfg.T,
    velocity: (cfg.velocityT * cfg.minSpacing) / cfg.T,
    aMinus: cfg.aPlus * cfg.aMinusRatio,
    targetRate: cfg.targetRateT / cfg.T,
    noiseRate: cfg.noiseRateT / cfg.T,
    membraneDecay: Math.exp(-dt / (cfg.tauMembraneT * cfg.T)),
    globalInhDecay: Math.exp(-dt / (cfg.globalInhibitionTauT * cfg.T)),
  };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export class Network {
  constructor(config = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.d = derive(this.cfg);
    this.rng = mulberry32(this.cfg.seed);
    this.learning = true;
    this.lateralNow = this.lateralAt(0);

    this.#place();
    this.#wire();
    this.#buildDeliveryRing();
    this.reset();
  }

  // Lateral inhibition at a given point through training, 0 = start, 1 = end.
  lateralAt(progress) {
    const cfg = this.cfg;
    const start = cfg.lateralInhibitionStart ?? cfg.lateralInhibition;
    const end = cfg.lateralInhibitionEnd ?? cfg.lateralInhibition;
    return start + (end - start) * progress;
  }

  // --- construction ---------------------------------------------------------

  // Same growth rule as interactiveNeurons.html: each new neuron is placed at a
  // random offset from an existing one, subject to a minimum spacing. This
  // produces the organic blob shape and, importantly, the distance distribution
  // that the axonal delays are drawn from.
  #place() {
    const cfg = this.cfg;
    const { numNeurons, minSpacing } = cfg;

    if (cfg.width == null || cfg.height == null) {
      const area = numNeurons * cfg.areaPerNeuron;
      cfg.height = Math.sqrt(area / cfg.aspect);
      cfg.width = cfg.height * cfg.aspect;
    }
    const { width, height } = cfg;

    const rnd = this.rng;
    // Spatial hash so the minimum-spacing test stays O(1) instead of O(n).
    const cell = minSpacing;
    const cols = Math.ceil(width / cell) + 1;
    const grid = new Map();
    const key = (x, y) => Math.floor(y / cell) * cols + Math.floor(x / cell);
    const tooClose = (x, y) => {
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bucket = grid.get((gy + dy) * cols + (gx + dx));
          if (!bucket) continue;
          for (const p of bucket) {
            if (Math.hypot(x - p.x, y - p.y) < minSpacing) return true;
          }
        }
      }
      return false;
    };
    const insert = (p) => {
      const k = key(p.x, p.y);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(p);
    };

    const first = { x: width / 2, y: height / 2 };
    const pts = [first];
    insert(first);

    let attempts = 0;
    const maxAttempts = numNeurons * 200;
    while (pts.length < numNeurons && attempts < maxAttempts) {
      attempts++;
      const ref = pts[Math.floor(rnd() * pts.length)];
      for (let a = 0; a < 30; a++) {
        const ang = rnd() * Math.PI * 2;
        const dist = minSpacing + rnd() * minSpacing * 2;
        const x = ref.x + Math.cos(ang) * dist;
        const y = ref.y + Math.sin(ang) * dist;
        if (x < minSpacing / 2 || x > width - minSpacing / 2) continue;
        if (y < minSpacing / 2 || y > height - minSpacing / 2) continue;
        if (tooClose(x, y)) continue;
        const p = { x, y };
        pts.push(p);
        insert(p);
        break;
      }
    }

    this.neurons = pts.map((p, i) => ({
      index: i,
      x: p.x,
      y: p.y,
      inhibitory: rnd() < this.cfg.inhFraction,
      v: 0,
      theta: 0,
      refracUntil: -1,
      lastSpike: -1e9,
      yTrace: 0,
      yTraceTime: 0,
      nextNoise: 0,
      spikeCount: 0,
      assembly: -1, // index into this.characters, or -1
      out: [],
      in: [],
    }));
  }

  #wire() {
    const { numNeighbors } = this.cfg;
    const { velocity } = this.d;
    this.synapses = [];
    for (const n of this.neurons) {
      const near = this.neurons
        .filter((o) => o !== n)
        .map((o) => ({ o, dist: Math.hypot(n.x - o.x, n.y - o.y) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, numNeighbors);
      for (const { o, dist } of near) {
        const magnitude = this.cfg.wInit * (0.5 + this.rng());
        const s = {
          pre: n,
          post: o,
          dist,
          delay: dist / velocity,
          delaySteps: Math.max(1, Math.round(dist / velocity / this.d.dt)),
          // Dale's law: the sign is a property of the presynaptic neuron, so a
          // synapse can never change from excitatory to inhibitory by learning.
          weight: n.inhibitory ? -magnitude * this.cfg.inhGain : magnitude,
          plastic: !n.inhibitory && !o.inhibitory,
          xTrace: 0,
          xTraceTime: 0,
          lastActive: -1e9,
        };
        n.out.push(s);
        o.in.push(s);
        this.synapses.push(s);
      }
    }
    this.maxDelaySteps = this.synapses.reduce((m, s) => Math.max(m, s.delaySteps), 1);
  }

  #buildDeliveryRing() {
    this.ringSize = this.maxDelaySteps + 2;
    this.ring = Array.from({ length: this.ringSize }, () => []);
  }

  // Assign `assemblySize` neurons to each character. Only excitatory neurons
  // are used, so that a character can never be represented by an inhibitory
  // cell (which would make driving it produce inhibition).
  assignAssemblies(characters, assemblySize = this.cfg.assemblySize) {
    this.characters = characters.slice();
    const excitatory = this.neurons.filter((n) => !n.inhibitory);
    // Fisher-Yates with the seeded RNG so assemblies are reproducible.
    for (let i = excitatory.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [excitatory[i], excitatory[j]] = [excitatory[j], excitatory[i]];
    }
    this.assemblies = characters.map(() => []);
    let cursor = 0;
    for (let c = 0; c < characters.length; c++) {
      for (let k = 0; k < assemblySize && cursor < excitatory.length; k++, cursor++) {
        excitatory[cursor].assembly = c;
        this.assemblies[c].push(excitatory[cursor]);
      }
    }
    return this.assemblies;
  }

  // --- state ----------------------------------------------------------------

  reset() {
    this.t = 0;
    this.stepIndex = 0;
    this.globalInh = 0;
    this.spikesThisStep = [];
    for (const r of this.ring) r.length = 0;
    for (const n of this.neurons) {
      n.v = 0;
      n.refracUntil = -1;
      n.lastSpike = -1e9;
      n.yTrace = 0;
      n.yTraceTime = 0;
      n.spikeCount = 0;
      n.nextNoise = this.#nextNoiseDelay();
    }
    for (const s of this.synapses) {
      s.xTrace = 0;
      s.xTraceTime = 0;
      s.lastActive = -1e9;
    }
  }

  // Reset activity but keep learned weights and adapted thresholds.
  resetActivity() {
    const thetas = this.neurons.map((n) => n.theta);
    this.reset();
    this.neurons.forEach((n, i) => (n.theta = thetas[i]));
  }

  #nextNoiseDelay() {
    // Exponential inter-arrival time for a Poisson process.
    return -Math.log(1 - this.rng()) / Math.max(1e-9, this.d.noiseRate);
  }

  // --- traces ---------------------------------------------------------------
  // Traces decay continuously but are only read when a spike occurs, so they
  // are evaluated lazily from a timestamp instead of being stepped every tick.

  #readX(s) {
    return s.xTrace * Math.exp(-(this.t - s.xTraceTime) / this.d.tauPlus);
  }

  #readY(n) {
    return n.yTrace * Math.exp(-(this.t - n.yTraceTime) / this.d.tauMinus);
  }

  // --- dynamics -------------------------------------------------------------

  driveAssembly(charIndex, amplitude) {
    for (const n of this.assemblies[charIndex]) {
      if (this.t >= n.refracUntil) n.v += amplitude;
    }
  }

  step() {
    const cfg = this.cfg;
    const d = this.d;
    const slot = this.stepIndex % this.ringSize;

    // 1. Deliver spikes whose axonal travel time has elapsed.
    const arriving = this.ring[slot];
    for (let i = 0; i < arriving.length; i++) {
      const s = arriving[i];
      const post = s.post;
      s.lastActive = this.t;

      if (this.t >= post.refracUntil) {
        post.v = Math.max(cfg.vMin, post.v + s.weight);
      }

      // Depression: this spike arrived AFTER the postsynaptic neuron fired.
      if (this.learning && s.plastic) {
        const y = this.#readY(post);
        if (y > 1e-4) {
          const scale = cfg.softBounds ? s.weight : 1;
          s.weight = Math.max(0, s.weight - d.aMinus * y * scale);
        }
      }
      // Record the arrival for a possible future potentiation.
      s.xTrace = this.#readX(s) + 1;
      s.xTraceTime = this.t;
    }
    arriving.length = 0;

    // 2. Integrate membranes, apply noise, and fire.
    this.globalInh *= d.globalInhDecay;
    const floor = cfg.threshold + this.globalInh;
    this.spikesThisStep.length = 0;
    for (const n of this.neurons) {
      if (this.t < n.refracUntil) {
        n.v = 0; // shunted during the refractory period
      } else {
        n.v *= d.membraneDecay;
        if (this.t >= n.nextNoise) {
          n.v += cfg.noiseAmp;
          n.nextNoise = this.t + this.#nextNoiseDelay();
        }
        if (n.v >= floor + n.theta) this.#fire(n);
      }
      // Homeostatic threshold relaxes toward the target rate.
      if (cfg.thetaGain > 0) {
        n.theta = Math.max(cfg.thetaMin, n.theta - cfg.thetaGain * d.targetRate * d.dt);
      }
    }

    this.t += d.dt;
    this.stepIndex++;
  }

  #fire(n) {
    const cfg = this.cfg;
    const d = this.d;

    n.spikeCount++;
    n.lastSpike = this.t;
    n.v = 0;
    n.refracUntil = this.t + d.refractory;
    n.theta = Math.min(cfg.thetaMax, n.theta + cfg.thetaGain);
    this.globalInh += cfg.globalInhibition * cfg.threshold;
    this.spikesThisStep.push(n);

    // Potentiation: strengthen every incoming synapse that delivered a spike
    // shortly BEFORE this neuron fired. This is where the axonal delay does the
    // work, because it decides which presynaptic spikes land inside the window.
    if (this.learning) {
      for (const s of n.in) {
        if (!s.plastic) continue;
        const x = this.#readX(s);
        if (x > 1e-4) {
          const scale = cfg.softBounds ? cfg.wMax - s.weight : 1;
          s.weight = Math.min(cfg.wMax, s.weight + cfg.aPlus * x * scale);
        }
      }
      n.yTrace = this.#readY(n) + 1;
      n.yTraceTime = this.t;
    }

    // Lateral inhibition inside the character assembly: the first cells to fire
    // suppress their neighbours, so only the context-appropriate subset of the
    // assembly wins.
    if (this.lateralNow > 0 && n.assembly >= 0) {
      for (const other of this.assemblies[n.assembly]) {
        if (other !== n && this.t >= other.refracUntil) {
          other.v = Math.max(cfg.vMin, other.v - this.lateralNow);
        }
      }
    }

    // Launch spikes down the axons.
    for (const s of n.out) {
      const target = (this.stepIndex + s.delaySteps) % this.ringSize;
      this.ring[target].push(s);
    }
  }

  // --- diagnostics ----------------------------------------------------------

  stats() {
    const exc = this.synapses.filter((s) => s.plastic);
    const w = exc.map((s) => s.weight);
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    const totalSpikes = this.neurons.reduce((a, n) => a + n.spikeCount, 0);
    return {
      meanWeight: mean,
      fracAtMax: w.filter((x) => x > this.cfg.wMax * 0.99).length / w.length,
      fracAtZero: w.filter((x) => x < this.cfg.wMax * 0.01).length / w.length,
      meanRateHz: totalSpikes / this.neurons.length / Math.max(1e-9, this.t),
      ratePerT: (totalSpikes / this.neurons.length / Math.max(1e-9, this.t)) * this.cfg.T,
      refractoryCeilingHz: 1 / this.d.refractory,
      meanTheta: this.neurons.reduce((a, n) => a + n.theta, 0) / this.neurons.length,
      delayMinT: (Math.min(...this.synapses.map((s) => s.delay)) / this.cfg.T),
      delayMaxT: (Math.max(...this.synapses.map((s) => s.delay)) / this.cfg.T),
    };
  }
}

// ---------------------------------------------------------------------------
// Structural analysis
// ---------------------------------------------------------------------------

// The binding constraint on this whole scheme is CONVERGENCE: for assembly A to
// drive assembly B one character later, some cell in B must receive several
// synapses from A whose axonal delays all land inside the STDP potentiation
// window. STDP can only strengthen synapses that already exist with the right
// delay; it cannot create them. This measures whether they are there at all.
//
// `needed` is how many simultaneous maximum-weight inputs it takes to reach
// threshold from rest.
export function analyzeConvergence(net, { hops = 1 } = {}) {
  const cfg = net.cfg;
  const T = cfg.T;
  const windowLo = T - cfg.stdpCutoffTaus * cfg.tauPlusT * T;
  const windowHi = T;
  const needed = Math.ceil(cfg.threshold / cfg.wMax);

  // delay-filtered fan-in counts, per (source assembly -> target cell)
  const perPairBest = [];
  const perPairCells = [];

  for (let a = 0; a < net.assemblies.length; a++) {
    const source = new Set(net.assemblies[a]);
    // counts[targetNeuronIndex] = number of in-window paths from assembly a
    const counts = new Map();
    const add = (target, n) => counts.set(target, (counts.get(target) || 0) + n);

    for (const pre of source) {
      for (const s1 of pre.out) {
        if (s1.weight < 0) continue;
        if (hops >= 1 && s1.delay > windowLo && s1.delay <= windowHi) add(s1.post, 1);
        if (hops >= 2) {
          for (const s2 of s1.post.out) {
            if (s2.weight < 0) continue;
            const d = s1.delay + s2.delay;
            if (d > windowLo && d <= windowHi) add(s2.post, 1);
          }
        }
      }
    }

    for (let b = 0; b < net.assemblies.length; b++) {
      if (b === a) continue;
      const cells = net.assemblies[b].map((n) => counts.get(n) || 0);
      perPairBest.push(Math.max(...cells));
      perPairCells.push(cells.filter((c) => c >= needed).length);
    }
  }

  const mean = (xs) => xs.reduce((p, q) => p + q, 0) / xs.length;
  return {
    needed,
    windowLoT: windowLo / T,
    windowHiT: windowHi / T,
    meanBestFanIn: mean(perPairBest),
    meanDrivableCells: mean(perPairCells),
    // fraction of assembly pairs where at least one cell could be driven
    pairsCovered: perPairCells.filter((c) => c > 0).length / perPairCells.length,
  };
}

// The decisive diagnostic: did STDP strengthen the synapses that carry the
// sequence, or did it just shuffle weights around?
//
// Every excitatory synapse between two character assemblies is sorted into four
// bins by whether the pair is a real transition in the sequence and whether its
// axonal delay lands in the potentiation window. Comparing "transition, in
// window" against "non-transition, in window" isolates sequence learning from
// any bias the delay distribution might introduce on its own.
export function weightSelectivity(net, sequence) {
  const cfg = net.cfg;
  const chars = net.characters;
  const index = new Map(chars.map((c, i) => [c, i]));
  const transitions = new Set();
  for (let i = 0; i + 1 < sequence.length; i++) {
    transitions.add(index.get(sequence[i]) + "-" + index.get(sequence[i + 1]));
  }
  const windowLo = cfg.T - cfg.stdpCutoffTaus * cfg.tauPlusT * cfg.T;

  const bins = {
    transitionInWindow: [],
    transitionOutOfWindow: [],
    otherInWindow: [],
    otherOutOfWindow: [],
    background: [],
  };

  for (const s of net.synapses) {
    if (!s.plastic) continue;
    const a = s.pre.assembly;
    const b = s.post.assembly;
    if (a < 0 || b < 0 || a === b) {
      bins.background.push(s.weight);
      continue;
    }
    const inWindow = s.delay > windowLo && s.delay <= cfg.T;
    const isTransition = transitions.has(a + "-" + b);
    if (isTransition) {
      bins[inWindow ? "transitionInWindow" : "transitionOutOfWindow"].push(s.weight);
    } else {
      bins[inWindow ? "otherInWindow" : "otherOutOfWindow"].push(s.weight);
    }
  }

  const summary = {};
  for (const [k, v] of Object.entries(bins)) {
    summary[k] = {
      n: v.length,
      mean: v.length ? v.reduce((p, q) => p + q, 0) / v.length : 0,
      fracAtMax: v.length ? v.filter((w) => w > cfg.wMax * 0.95).length / v.length : 0,
    };
  }
  // How much stronger is the sequence-carrying population than the identically
  // delayed but sequence-irrelevant one? 1.0 means no learning at all.
  summary.selectivity =
    summary.otherInWindow.mean > 0
      ? summary.transitionInWindow.mean / summary.otherInWindow.mean
      : 0;
  return summary;
}

// Single-step propagation: for each transition in the sequence, silence the
// background, fire the source assembly alone, and see whether the correct
// successor responds at t = T.
//
// This is much better conditioned than recall accuracy. Recall requires every
// step of a chain to work at once, so it reads zero until the whole thing
// works; propagation degrades gracefully and shows how close the network is.
// `gain` is the ratio of successor spikes to source spikes: a chain can only
// sustain itself if it is at least 1.
export function measurePropagation(net, sequence) {
  const cfg = net.cfg;
  const chars = net.characters;
  const wasLearning = net.learning;
  net.learning = false;
  net.lateralNow = net.lateralAt(1);

  const seen = new Set();
  let propagated = 0;
  let tested = 0;
  let gainSum = 0;

  for (let i = 0; i < sequence.length; i++) {
    const from = chars.indexOf(sequence[i]);
    const to = chars.indexOf(sequence[(i + 1) % sequence.length]);
    if (from === to || from < 0 || to < 0) continue;
    const key = from + "-" + to;
    if (seen.has(key)) continue;
    seen.add(key);
    tested++;

    net.resetActivity();
    for (const n of net.neurons) {
      n.nextNoise = Infinity;
      n.theta = 0;
    }
    net.driveAssembly(from, cfg.driveStart);

    let sourceSpikes = 0;
    const counts = new Array(chars.length).fill(0);
    const half = Math.floor(cfg.stepsPerT / 5);
    for (let s = 0; s < cfg.stepsPerT + half; s++) {
      net.step();
      for (const n of net.spikesThisStep) {
        if (n.assembly < 0) continue;
        if (s < half && n.assembly === from) sourceSpikes++;
        else if (s >= cfg.stepsPerT - half) counts[n.assembly]++;
      }
    }
    const correct = counts[to];
    const other = counts.reduce((a, c, ci) => (ci === to || ci === from ? a : a + c), 0);
    if (correct > 0 && correct >= other) propagated++;
    gainSum += sourceSpikes > 0 ? correct / sourceSpikes : 0;
  }

  net.learning = wasLearning;
  return {
    propagationFraction: tested ? propagated / tested : 0,
    meanGain: tested ? gainSum / tested : 0,
  };
}

// ---------------------------------------------------------------------------
// Sequence experiment
// ---------------------------------------------------------------------------

export function uniqueCharacters(sequence) {
  return [...new Set(sequence.split(""))].sort();
}

// The accuracy a perfect FIRST-ORDER predictor could reach: for each character,
// always guess its most common successor. Beating this is the only real
// evidence that the network is using context rather than pairwise association.
export function firstOrderCeiling(sequence) {
  const counts = new Map();
  for (let i = 0; i + 1 < sequence.length; i++) {
    const a = sequence[i];
    if (!counts.has(a)) counts.set(a, new Map());
    const m = counts.get(a);
    m.set(sequence[i + 1], (m.get(sequence[i + 1]) || 0) + 1);
  }
  let correct = 0;
  let total = 0;
  for (const m of counts.values()) {
    const values = [...m.values()];
    correct += Math.max(...values);
    total += values.reduce((a, b) => a + b, 0);
  }
  return correct / total;
}

export function chanceLevel(sequence) {
  return 1 / uniqueCharacters(sequence).length;
}

export function train(net, sequence, { presentations, onProgress } = {}) {
  const cfg = net.cfg;
  const chars = net.characters;
  const indexOf = new Map(chars.map((c, i) => [c, i]));
  const totalChars = presentations * sequence.length;
  net.learning = true;

  for (let p = 0; p < presentations; p++) {
    const progress = presentations > 1 ? p / (presentations - 1) : 1;
    const drive = cfg.driveStart + (cfg.driveEnd - cfg.driveStart) * progress;
    net.lateralNow = net.lateralAt(progress);
    for (let i = 0; i < sequence.length; i++) {
      net.driveAssembly(indexOf.get(sequence[i]), drive);
      for (let s = 0; s < cfg.stepsPerT; s++) net.step();
    }
    if (onProgress) onProgress(p, presentations);
  }
  return { totalChars };
}

// Free-running recall: seed the network with the first few characters, then cut
// the input and read out which assembly fires in each subsequent time window.
// `tempoScale` is the ratio of the network's free replay interval to T. STDP can
// only strengthen a synapse whose spike arrives BEFORE the postsynaptic cell
// fires, so every learned delay is shorter than T and free replay runs fast.
// Compressed replay is a real property of STDP-trained sequences rather than an
// artefact, so the readout clock has to follow it or the scoring drifts out of
// phase after a few characters.
export function recall(net, sequence, { seedChars = 3, tempoScale = 1.0 } = {}) {
  const cfg = net.cfg;
  const chars = net.characters;
  const indexOf = new Map(chars.map((c, i) => [c, i]));
  const wasLearning = net.learning;
  net.learning = false;
  net.lateralNow = net.lateralAt(1);
  net.resetActivity();

  // Seed: drive the opening characters exactly as during training.
  for (let i = 0; i < seedChars; i++) {
    net.driveAssembly(indexOf.get(sequence[i]), cfg.driveStart);
    for (let s = 0; s < cfg.stepsPerT; s++) net.step();
  }

  // Free-run, recording every assembly spike with its time. Spikes are binned
  // afterwards into windows CENTRED on each character's due time. Centring
  // matters: with axonal delays spread below T, a correctly recalled character
  // fires slightly early, and a window starting at the due time would credit it
  // to the previous character.
  const half = Math.floor(cfg.stepsPerT / 2);
  const stride = cfg.stepsPerT * tempoScale;
  const freeSteps = Math.ceil((sequence.length - seedChars) * stride + half);
  const events = [];
  const startStep = net.stepIndex;
  for (let s = 0; s < freeSteps; s++) {
    net.step();
    for (const n of net.spikesThisStep) {
      if (n.assembly >= 0) events.push({ step: net.stepIndex - startStep, assembly: n.assembly });
    }
  }

  const predictions = [];
  for (let i = seedChars; i < sequence.length; i++) {
    const centre = (i - seedChars) * stride;
    const counts = new Array(chars.length).fill(0);
    for (const e of events) {
      if (e.step >= centre - half && e.step < centre + half) counts[e.assembly]++;
    }
    const best = counts.reduce((bi, c, ci) => (c > counts[bi] ? ci : bi), 0);
    const total = counts.reduce((a, b) => a + b, 0);
    predictions.push({
      expected: sequence[i],
      predicted: total > 0 ? chars[best] : null,
      counts,
      total,
    });
  }

  net.learning = wasLearning;

  const scored = predictions.length;
  const correct = predictions.filter((p) => p.predicted === p.expected).length;
  let runLength = 0;
  for (const p of predictions) {
    if (p.predicted === p.expected) runLength++;
    else break;
  }
  const silent = predictions.filter((p) => p.total === 0).length;

  return {
    accuracy: scored ? correct / scored : 0,
    runLength,
    silentFraction: scored ? silent / scored : 1,
    predictions,
  };
}

export function runExperiment(config, sequence, opts = {}) {
  const net = new Network(config);
  net.assignAssemblies(uniqueCharacters(sequence));
  train(net, sequence, { presentations: opts.presentations ?? 60 });
  const trainStats = net.stats();
  const result = recall(net, sequence, { seedChars: opts.seedChars ?? 3 });
  return {
    accuracy: result.accuracy,
    runLength: result.runLength,
    silentFraction: result.silentFraction,
    firstOrderCeiling: firstOrderCeiling(sequence),
    chance: chanceLevel(sequence),
    stats: trainStats,
    net,
    predictions: result.predictions,
  };
}
