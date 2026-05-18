import { readFileSync } from "node:fs";

const [leftFile, rightFile] = process.argv.slice(2);

if (!leftFile || !rightFile) {
  console.error("usage: node scripts/compare-results.mjs <left.json> <right.json>");
  process.exit(2);
}

const left = JSON.parse(readFileSync(leftFile, "utf8"));
const right = JSON.parse(readFileSync(rightFile, "utf8"));

const differences = compareResultFiles(left, right);

if (differences.length > 0) {
  console.error(`result files differ: ${leftFile} vs ${rightFile}`);
  for (const difference of differences.slice(0, 20)) console.error(`- ${difference}`);
  if (differences.length > 20) console.error(`- ... ${differences.length - 20} more difference(s)`);
  process.exit(1);
}

console.log("result files match");

function compareResultFiles(left, right) {
  const shapeError = validateShape(left, "left") ?? validateShape(right, "right");
  if (shapeError) return [shapeError];

  const differences = [];
  if (left.version !== right.version) differences.push(`version: left=${format(left.version)} right=${format(right.version)}`);

  const leftResults = indexResults(left.results, "left", differences);
  const rightResults = indexResults(right.results, "right", differences);

  for (const [key, leftResult] of leftResults) {
    const rightResult = rightResults.get(key);
    if (!rightResult) {
      differences.push(`missing in right: ${displayKey(leftResult)}`);
      continue;
    }
    compareResult(leftResult, rightResult, differences);
  }

  for (const [key, rightResult] of rightResults) {
    if (!leftResults.has(key)) differences.push(`unexpected in right: ${displayKey(rightResult)}`);
  }

  return differences;
}

function validateShape(value, label) {
  if (!value || typeof value !== "object") return `${label}: expected object`;
  if (!Array.isArray(value.results)) return `${label}: expected results array`;
  return undefined;
}

function indexResults(results, label, differences) {
  const indexed = new Map();

  for (const result of results) {
    const key = resultKey(result);
    if (indexed.has(key)) differences.push(`${label}: duplicate result key ${displayKey(result)}`);
    indexed.set(key, result);
  }

  return indexed;
}

function compareResult(leftResult, rightResult, differences) {
  const label = displayKey(leftResult);
  for (const field of ["status", "value", "error"]) {
    if (leftResult[field] !== rightResult[field]) {
      differences.push(`${label}: ${field}: left=${format(leftResult[field])} right=${format(rightResult[field])}`);
    }
  }
}

function resultKey(result) {
  return `${result.file}\0${result.id}\0${result.operation}`;
}

function displayKey(result) {
  return `${result.file} ${result.id} (${result.operation})`;
}

function format(value) {
  return value === undefined ? "<missing>" : JSON.stringify(value);
}
