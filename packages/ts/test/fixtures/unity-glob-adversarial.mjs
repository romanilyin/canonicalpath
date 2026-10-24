import assert from "node:assert/strict";

const { CanonicalPathBroker, FakeUnityBridge, createUnityMCPTools, fakeUnityScopedFileKey } = await import(process.argv[2]);
const projectId = "adversarial-glob";
const broker = new CanonicalPathBroker();
broker.registerProject({ projectId, projectRoot: "/repo/Game", normalizeOptions: { sourceHost: "posix", targetProfile: "posix" } });
let cases = 0;

for (const length of [32, 64, 128, 255]) {
  const path = `notes/${"a".repeat(length)}`;
  const bridge = new FakeUnityBridge(broker, { scopedFiles: { [fakeUnityScopedFileKey(projectId, "knowledge", path)]: "" } });
  const tools = createUnityMCPTools(bridge);
  const glob = `notes/${"a*".repeat(Math.floor((length - 1) / 2))}!`;
  const result = await tools.callTool("unity.knowledge.glob", { project_id: projectId, glob, max_entries: 1 });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent.entries, []);
  cases++;
}

const component = "a".repeat(255);
const path = `notes/${component}/${component}`;
const bridge = new FakeUnityBridge(broker, { scopedFiles: { [fakeUnityScopedFileKey(projectId, "knowledge", path)]: "" } });
const tools = createUnityMCPTools(bridge);
const failing = `notes/${"a*".repeat(124)}aa/${"a*".repeat(127)}!`;
assert.equal(failing.length, 512);
const failedMatch = await tools.callTool("unity.knowledge.glob", { project_id: projectId, glob: failing, max_entries: 1 });
assert.notEqual(failedMatch.isError, true);
assert.deepEqual(failedMatch.structuredContent.entries, []);
cases++;

const successful = failing.slice(0, -1) + "a";
const matched = await tools.callTool("unity.knowledge.glob", { project_id: projectId, glob: successful, max_entries: 1 });
assert.notEqual(matched.isError, true);
assert.deepEqual(matched.structuredContent.entries.map((entry) => entry.path), [path]);
cases++;

const redundant = await tools.callTool("unity.knowledge.glob", { project_id: projectId, glob: `notes/${"*".repeat(254)}`, max_entries: 1 });
assert.notEqual(redundant.isError, true);
assert.deepEqual(redundant.structuredContent.entries.map((entry) => entry.path), [path]);
cases++;

process.stdout.write(JSON.stringify({ completed: true, cases }));
