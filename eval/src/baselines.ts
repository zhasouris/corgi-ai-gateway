import type { ModelDescriptor } from "../../src/types.js";

/**
 * Fixed-policy baselines — the yardstick a real router must beat. Each picks
 * from the already constraint-filtered candidate set. `random` is seeded by the
 * scenario index so runs stay deterministic (no Math.random).
 */
export interface Baseline {
  name: string;
  pick(candidates: ModelDescriptor[], index: number): ModelDescriptor;
}

const blended = (m: ModelDescriptor) => m.costPer1kInput + m.costPer1kOutput;

export const baselines: Baseline[] = [
  {
    name: "always-cheapest",
    pick: (c) => [...c].sort((a, b) => blended(a) - blended(b))[0]!,
  },
  {
    name: "always-strongest",
    pick: (c) => [...c].sort((a, b) => b.tier - a.tier || blended(a) - blended(b))[0]!,
  },
  {
    name: "random",
    pick: (c, i) => c[i % c.length]!,
  },
];
