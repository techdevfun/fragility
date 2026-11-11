#!/usr/bin/env node
/**
 * Generate the synthetic seeded demo-repo files (seed 20261111).
 * Usage: node scripts/gen-demo-fixture.js <outDir>
 *
 * Writes the baseline files (cart.ts + cart.test.ts) and the fragile
 * PR files (checkout module rebuilt from examples/pr-fragile.diff plus
 * a generated discount-rules.ts: 12 groups x 5 chained rule functions,
 * 18 lines each = 1,080 lines of AI-style wrapper boilerplate).
 * Everything is deterministic: no randomness, no timestamps in files.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: gen-demo-fixture.js <outDir>");
  process.exit(2);
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseDiffAdded(text) {
  const files = new Map();
  let current = null;
  let inHunk = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("diff --git ")) {
      current = null;
      inHunk = false;
      continue;
    }
    const mNew = /^\+\+\+ b\/(.+)$/.exec(line);
    if (mNew) {
      current = mNew[1];
      files.set(current, []);
      continue;
    }
    if (/^@@ /.test(line)) {
      inHunk = true;
      continue;
    }
    if (!inHunk || !current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      files.get(current).push(line.slice(1));
    }
  }
  return files;
}

// --- baseline: small cart module + real tests ---------------------------
const cartTs = `// Cart module - synthetic fixture (seed 20261111).
export interface CartItem {
  sku: string;
  price: number;
  qty: number;
}

export function cartTotal(items: CartItem[]): number {
  let total = 0;
  for (const item of items) {
    if (item.qty <= 0) continue;
    total += item.price * item.qty;
  }
  return total;
}
`;
const cartTest = `// Tests for cartTotal - synthetic fixture (seed 20261111).
import { cartTotal } from "./cart";

test("sums item prices", () => {
  expect(cartTotal([{ sku: "a", price: 100, qty: 2 }])).toBe(200);
  expect(cartTotal([])).toBe(0);
});

test("ignores zero-quantity items", () => {
  expect(cartTotal([{ sku: "a", price: 100, qty: 0 }])).toBe(0);
});
`;

// --- fragile PR: checkout module from the fixture diff ------------------
const fragileDiff = readFileSync(join(ROOT, "examples", "pr-fragile.diff"), "utf8");
const fragileFiles = parseDiffAdded(fragileDiff);

// --- generated discount rules: 12 groups x 5 chained functions --------
let rules = "// Discount rules - synthetic fixture (seed 20261111).\n";
rules += "// Generated wrapper boilerplate: 12 groups of 5 chained helpers.\n\n";
for (let g = 0; g < 12; g++) {
  const names = ["a", "b", "c", "d", "e"];
  for (let i = 0; i < 5; i++) {
    const fn = `rule${g}${names[i]}`;
    const next = i < 4 ? `rule${g}${names[i + 1]}` : null;
    rules += `function ${fn}(amount: number, tier: string): number {\n`;
    rules += `  let out = amount;\n`;
    rules += `  if (tier === "gold") out = out * 0.9;\n`;
    rules += `  if (tier === "silver") out = out * 0.95;\n`;
    rules += `  if (tier === "bronze") out = out * 0.99;\n`;
    rules += `  if (out < 0) out = 0;\n`;
    rules += `  if (out > 10000) out = 10000;\n`;
    rules += `  if (amount > 500) out = out - 5;\n`;
    rules += `  if (amount < 10) out = out + 1;\n`;
    rules += `  const fees = [1, 2, 3];\n`;
    rules += `  let fee = 0;\n`;
    rules += `  for (const f of fees) fee += f;\n`;
    rules += `  out = out + fee;\n`;
    rules += `  if (fee > 5) out = out - fee;\n`;
    rules += `  if (out === 0) return 0;\n`;
    rules += next ? `  return ${next}(out, tier);\n` : `  return out;\n`;
    rules += `}\n\n`;
  }
}
rules += `export function applyRules(amount: number, tier: string): number {\n`;
rules += `  return rule0a(amount, tier);\n`;
rules += `}\n`;

mkdirSync(join(outDir, "src"), { recursive: true });
writeFileSync(join(outDir, "src", "cart.ts"), cartTs);
writeFileSync(join(outDir, "src", "cart.test.ts"), cartTest);
for (const [path, lines] of fragileFiles) {
  writeFileSync(join(outDir, path), lines.join("\n") + "\n");
}
writeFileSync(join(outDir, "src", "discount-rules.ts"), rules);
console.log(`demo fixture written to ${outDir}`);
