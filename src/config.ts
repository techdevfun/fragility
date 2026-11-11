/**
 * Config: fragility.config.json. Every threshold is a default that a
 * team can tune; `fragility init` writes this file with the defaults.
 * The file is JSON, so it must be valid before tests run.
 */
import { readFileSync, existsSync } from "node:fs";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./abstraction.js";
import { DEFAULT_MARKERS } from "./comprehension.js";

export interface FragilityConfig {
  thresholds: Thresholds;
  markers: string[];
  failUnder: number;
}

export const DEFAULT_CONFIG: FragilityConfig = {
  thresholds: DEFAULT_THRESHOLDS,
  markers: DEFAULT_MARKERS,
  failUnder: 60,
};

export function loadConfig(path?: string): FragilityConfig {
  if (!path || !existsSync(path)) return structuredClone(DEFAULT_CONFIG);
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<FragilityConfig>;
    return {
      thresholds: { ...DEFAULT_THRESHOLDS, ...(raw.thresholds ?? {}) },
      markers: raw.markers ?? DEFAULT_MARKERS,
      failUnder: raw.failUnder ?? 60,
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function defaultConfigJson(): string {
  return JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n";
}
