// Protocol test for the stdio MCP server:  node validation/test_mcp.js
// Spawns mcp/server.js and speaks newline-delimited JSON-RPC 2.0 to it like an MCP client.
const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");
const A = require("../js/agent-core.js");

function client(env) {
  const p = spawn(process.execPath, [path.join(__dirname, "..", "mcp", "server.js")], { env: Object.assign({}, process.env, env || {}), stdio: ["pipe", "pipe", "pipe"] });
  let buf = "", id = 0;
  const waiting = new Map();
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const msg = JSON.parse(line);   // anything that is not JSON on stdout fails the test
      const key = Array.isArray(msg) ? "array" : msg.id;
      if (waiting.has(key)) { waiting.get(key)(msg); waiting.delete(key); }
      else if (!Array.isArray(msg) && msg.id != null && !waiting.size) throw new Error("unexpected reply " + line);
    }
  });
  return {
    request(method, params) { const mid = ++id; return new Promise((res) => { waiting.set(mid, res); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: mid, method, params }) + "\n"); }); },
    notify(method, params) { p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"); },
    raw(line) { return new Promise((res) => { waiting.set(null, res); p.stdin.write(line + "\n"); }); },
    rawArray(line) { return new Promise((res) => { waiting.set("array", res); p.stdin.write(line + "\n"); }); },
    close() { p.stdin.end(); return new Promise((res) => p.on("exit", res)); },
  };
}
const call = (c, name, args) => c.request("tools/call", { name, arguments: args || {} }).then((m) => m.result || m.error);

(async () => {
  const c = client();
  const init = await c.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  assert.strictEqual(init.result.protocolVersion, "2025-06-18", "echoes a supported version");
  assert.ok(init.result.capabilities.tools && init.result.serverInfo.name);
  c.notify("notifications/initialized");
  const odd = await c.request("initialize", { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(odd.result.protocolVersion) && odd.result.protocolVersion !== "1999-01-01", "unsupported version -> server's latest");
  assert.deepStrictEqual((await c.request("ping")).result, {});
  const list = (await c.request("tools/list")).result.tools;
  assert.deepStrictEqual(list.filter((t) => t.name !== "export_session"), JSON.parse(JSON.stringify(A.TOOLS)), "same registry as the browser");
  console.log("ok    initialize / version negotiation / ping / tools/list");

  const early = await call(c, "set_exercise_phase", { phase: "warmup", minutes: 5, target_hr_low: 70, target_hr_high: 100, target_rpe_low: 9, target_rpe_high: 11, instruction: "데우세요." });
  assert.strictEqual(early.isError, true, "exercise before the safety check is a tool error");
  assert.ok(/안전 확인/.test(early.structuredContent.reason));
  const unknown = await c.request("tools/call", { name: "increase_medication", arguments: {} });
  assert.strictEqual(unknown.error.code, -32602);
  const nf = await c.request("resources/list");
  assert.strictEqual(nf.error.code, -32601);
  c.notify("tools/list");                               // a notification must get no reply
  const inv = await c.raw('{"foo":1}');
  assert.ok(inv.error && inv.error.code === -32600 && inv.id === null, "invalid request -> -32600 with id null");
  const emptyBatch = await c.raw("[]");
  assert.ok(emptyBatch.error && emptyBatch.error.code === -32600);
  const batch = await c.rawArray('[{"jsonrpc":"2.0","id":901,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"},{"jsonrpc":"2.0","id":902,"method":"ping"}]');
  assert.ok(Array.isArray(batch) && batch.length === 2 && batch.every((r) => r.result), "batch answered as one array, notification skipped");
  console.log("ok    kernel veto surfaces as isError; unknown tool / method are JSON-RPC errors");

  const prof = await call(c, "get_patient_profile");
  assert.ok(!prof.isError && prof.structuredContent.eligibility.allow);
  const zone = (await call(c, "compute_target_zone")).structuredContent.zone;
  assert.ok((await call(c, "pre_session_safety_check")).structuredContent.passed);
  assert.ok(!(await call(c, "set_exercise_phase", { phase: "warmup", minutes: 5, target_hr_low: 70, target_hr_high: zone.hrLow, target_rpe_low: 9, target_rpe_high: 11, instruction: "가볍게 몸을 데우세요." })).isError);
  const bad = await call(c, "say_to_patient", { message: "가슴이 조여도 참고 계속하세요." });
  assert.ok(bad.isError);
  const chk = await call(c, "still_check_in", { reason: "준비운동 후" });
  assert.strictEqual(chk.structuredContent.kernel.action, "continue");
  const exp = (await call(c, "export_session")).structuredContent;
  assert.ok(exp.chainCheck.ok && exp.chainCheck.anchored && exp.fhir.meta.tag[0].code === "synthetic-test-data");
  console.log("ok    a simulated session runs over MCP; export carries the audit head and a synthetic-tagged FHIR bundle");
  await c.close();

  const c2 = client({ VITALLENS_SCENARIO: "chest_pain" });
  await c2.request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } });
  const z2 = (await call(c2, "compute_target_zone")).structuredContent.zone;
  await call(c2, "pre_session_safety_check");
  await call(c2, "set_exercise_phase", { phase: "warmup", minutes: 5, target_hr_low: 70, target_hr_high: z2.hrLow, target_rpe_low: 9, target_rpe_high: 11, instruction: "데우세요." });
  await call(c2, "still_check_in", { reason: "1" });
  await call(c2, "run_sts_test");
  const stop = await call(c2, "still_check_in", { reason: "2" });
  assert.strictEqual(stop.structuredContent.kernel.action, "stop");
  assert.ok((await call(c2, "set_exercise_phase", { phase: "work", minutes: 5, target_hr_low: z2.hrLow, target_hr_high: z2.hrHigh, target_rpe_low: 12, target_rpe_high: 14, instruction: "걸으세요." })).isError);
  await c2.close();
  console.log("ok    chest-pain scenario: the kernel stops the session and vetoes the client's next phase");
  console.log("\n4/4 MCP protocol checks passed");
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
