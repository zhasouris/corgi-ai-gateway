import { readFileSync } from "node:fs";
import type { Scenario } from "./types.js";

/** Load a JSONL dataset (one Scenario per line; blank lines ignored). */
export function loadDataset(path: string): Scenario[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Scenario);
}
