// Parallel parameter sweep.
//
//   node sweep.js <name>
//
// Each sweep prints a table sorted by the metric of interest. The two metrics
// that matter are:
//   selectivity - how much stronger the sequence-carrying synapses ended up
//                 than identically delayed synapses that carry nothing. 1.0
//                 means no learning happened at all.
//   accuracy    - free-running recall, to be compared against the first-order
//                 ceiling rather than against 100%.

import { Worker } from "node:worker_threads";
import os from "node:os";
import { fileURLToPath } from "node:url";

const WORKER = fileURLToPath(new URL("./worker.js", import.meta.url));

export async function runTasks(specs, { concurrency = Math.max(1, os.cpus().length - 2) } = {}) {
  const results = new Array(specs.length);
  let next = 0;
  let done = 0;
  const started = Date.now();

  await Promise.all(
    Array.from({ length: Math.min(concurrency, specs.length) }, () => {
      const worker = new Worker(WORKER);
      return new Promise((resolve, reject) => {
        const submit = () => {
          if (next >= specs.length) {
            worker.terminate();
            resolve();
            return;
          }
          const id = next++;
          worker.postMessage({ id, spec: specs[id].spec });
        };
        worker.on("message", (msg) => {
          if (msg.error) {
            worker.terminate();
            reject(new Error(msg.error));
            return;
          }
          results[msg.id] = msg.result;
          done++;
          if (done % 5 === 0 || done === specs.length) {
            const elapsed = (Date.now() - started) / 1000;
            const eta = (elapsed / done) * (specs.length - done);
            process.stderr.write(
              `\r  ${done}/${specs.length} done, ${elapsed.toFixed(0)}s elapsed, ~${eta.toFixed(0)}s left   `
            );
          }
          submit();
        });
        worker.on("error", reject);
        submit();
      });
    })
  );
  process.stderr.write("\n");
  return results;
}

export function printTable(specs, results, columns, sortBy) {
  const rows = specs.map((s, i) => ({ label: s.label, ...results[i] }));
  if (sortBy) rows.sort((a, b) => b[sortBy] - a[sortBy]);
  const widths = columns.map((c) => Math.max(c.header.length, 8));
  console.log(
    "config".padEnd(46) + columns.map((c, i) => c.header.padStart(widths[i] + 2)).join("")
  );
  console.log("-".repeat(46 + widths.reduce((a, b) => a + b + 2, 0)));
  for (const r of rows) {
    console.log(
      r.label.padEnd(46) +
        columns.map((c, i) => c.fmt(r[c.key]).padStart(widths[i] + 2)).join("")
    );
  }
}

export const COLUMNS = [
  { header: "propag", key: "propagation", fmt: (v) => (100 * v).toFixed(0) + "%" },
  { header: "gain", key: "gain", fmt: (v) => v.toFixed(2) },
  { header: "select", key: "selectivity", fmt: (v) => v.toFixed(2) },
  { header: "trans w", key: "transitionMean", fmt: (v) => v.toFixed(3) },
  { header: "tr@max", key: "transitionAtMax", fmt: (v) => (100 * v).toFixed(0) + "%" },
  { header: "other w", key: "otherMean", fmt: (v) => v.toFixed(3) },
  { header: "accuracy", key: "accuracy", fmt: (v) => (100 * v).toFixed(0) + "%" },
  { header: "run", key: "runLength", fmt: (v) => v.toFixed(1) },
  { header: "rate/T", key: "ratePerT", fmt: (v) => v.toFixed(2) },
];
