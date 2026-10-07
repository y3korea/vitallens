#!/usr/bin/env node
// VitalLens safety-kernel MCP server (stdio, no dependencies).
//
// Exposes the same tools, kernel, audit chain and FHIR export as agent.html, so any MCP client
// (Claude Code, Claude Desktop, an Agent SDK app, a test harness) can try to run a session and
// see the kernel veto it. The patient is SIMULATED (createVirtualPatient) — this server never
// touches a camera or a real person.
//
//   node mcp/server.js                         # normal virtual patient, low-risk profile
//   VITALLENS_SCENARIO=chest_pain node mcp/server.js
//   VITALLENS_PROFILE='{"age":75,"restHr":88,"risk":"low","copd":true}' node mcp/server.js
//   claude mcp add vitallens -- node /path/to/mcp/server.js
//
// Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout; logs go to stderr only.
"use strict";
const readline = require("readline");
const A = require("../js/agent-core.js");
const pkgVersion = "1.6.0";

const SUPPORTED_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"];
const LATEST = SUPPORTED_VERSIONS[SUPPORTED_VERSIONS.length - 1];

const scenario = process.env.VITALLENS_SCENARIO || "normal";
let profile = { id: "MCP-VP", age: 62, restHr: 70, betaBlocker: false, copd: false, risk: "low" };
try { if (process.env.VITALLENS_PROFILE) profile = Object.assign(profile, JSON.parse(process.env.VITALLENS_PROFILE)); }
catch (e) { process.stderr.write("VITALLENS_PROFILE is not valid JSON; using the default profile\n"); }

const harness = A.createHarness({ profile, executors: A.createVirtualPatient(scenario, 7), source: "mcp-virtual-patient", synthetic: true });

const EXTRA_TOOLS = [
  {
    name: "export_session",
    title: "세션 기록 내보내기",
    description: "Return the session's hash-chained audit log, its head hash, the chain check, and a FHIR R4 Bundle (synthetic-data tagged). Read-only.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];
const TOOLS = A.TOOLS.concat(EXTRA_TOOLS);

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function callTool(name, args) {
  if (name === "export_session") {
    await harness.audit.flush();
    const head = harness.audit.head();
    const check = await A.verifyAuditLog(harness.audit.entries, { expectedHead: head });
    const out = { auditHead: head, chainCheck: check, audit: harness.audit.entries, fhir: A.toFhirBundle(harness.session, { auditHead: head }) };
    return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out, isError: false };
  }
  const r = await harness.propose(name, args || {}, "mcp-client");
  const payload = JSON.parse(JSON.stringify(r == null ? {} : r, (k, v) => (k === "filtered" ? undefined : v)));
  return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload, isError: !!(r && r.vetoed) };
}

// Returns the response object, or null for notifications (JSON-RPC 2.0: never answer a notification).
async function handle(msg) {
  const validId = (id) => typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return fail(msg && typeof msg === "object" && validId(msg.id) ? msg.id : null, -32600, "Invalid Request");
  }
  const isRequest = "id" in msg;
  if (!isRequest) return null;
  if (!validId(msg.id)) return fail(null, -32600, "Invalid Request: id must be a string or number");
  const p = msg.params || {};
  switch (msg.method) {
    case "initialize": {
      const v = SUPPORTED_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : LATEST;
      return ok(msg.id, {
        protocolVersion: v,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "vitallens-safety-kernel", title: "VitalLens safety kernel (simulated patient)", version: pkgVersion },
        instructions: "Research prototype, not a medical device. Tools drive a SIMULATED cardiopulmonary rehab session through a deterministic safety kernel that can veto any call (isError: true with the reason and allowed limits) or stop the session. Start with get_patient_profile, compute_target_zone and pre_session_safety_check. Call export_session to get the audit chain and FHIR bundle.",
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: TOOLS });
    case "tools/call": {
      if (!TOOLS.some((t) => t.name === p.name)) return fail(msg.id, -32602, `Unknown tool: ${p.name}`);
      try { return ok(msg.id, await callTool(p.name, p.arguments)); }
      catch (e) { return ok(msg.id, { content: [{ type: "text", text: "Tool failed: " + e.message }], isError: true }); }
    }
    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

// Requests are handled one at a time, in order: the kernel is a sequential state machine.
let queue = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch (e) { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); return; }
  queue = queue.then(async () => {
    if (Array.isArray(msg)) {           // JSON-RPC batch (MCP 2025-03-26); later protocol versions drop batching
      if (!msg.length) return send(fail(null, -32600, "Invalid Request: empty batch"));
      const out = [];
      for (const m of msg) { const r = await handle(m); if (r) out.push(r); }
      if (out.length) send(out);
      return;
    }
    const r = await handle(msg);
    if (r) send(r);
  }).catch((e) => process.stderr.write(String((e && e.stack) || e) + "\n"));
});
rl.on("close", () => { queue.then(() => process.exit(0)); });
process.stderr.write(`vitallens MCP server ready (scenario: ${scenario}, simulated patient)\n`);
