import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadFixtures } from "../test/fixtures";
import { renderResults, runBenchmark } from "./benchmark";

const resultsPath = fileURLToPath(new URL("./results.md", import.meta.url));
const fixtures = loadFixtures();
const result = runBenchmark(fixtures);
const markdown = renderResults(result);

writeFileSync(resultsPath, markdown);
console.log(markdown);
if (!result.passes) {
  console.error("benchmark targets not met");
  process.exit(1);
}
