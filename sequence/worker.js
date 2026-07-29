import { parentPort } from "node:worker_threads";
import { runOne } from "./experiment.js";

parentPort.on("message", (task) => {
  try {
    const result = runOne(task.spec);
    parentPort.postMessage({ id: task.id, result });
  } catch (error) {
    parentPort.postMessage({ id: task.id, error: String(error && error.stack) });
  }
});
