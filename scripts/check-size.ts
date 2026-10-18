import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET_BYTES = 15360;
const bundlePath = fileURLToPath(new URL("../dist/browser/auto.global.js", import.meta.url));
const gzippedBytes = gzipSync(readFileSync(bundlePath)).length;

console.log(`dist/browser/auto.global.js: ${gzippedBytes} bytes gzipped (budget ${BUDGET_BYTES})`);
if (gzippedBytes > BUDGET_BYTES) {
  console.error(`browser bundle is ${gzippedBytes - BUDGET_BYTES} bytes over budget`);
  process.exit(1);
}
