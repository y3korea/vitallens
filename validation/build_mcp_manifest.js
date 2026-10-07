// Writes mcp/tools.json from the tool registry in js/agent-core.js (single source of truth).
//   node validation/build_mcp_manifest.js
// The file has exactly the shape of an MCP tools/list result ({ tools: [...] }) so it can be
// diffed against what the stdio server (mcp/server.js) returns.
const fs = require("fs");
const path = require("path");
const A = require("../js/agent-core.js");

function manifest() {
  return {
    _meta: {
      "io.github.y3korea/vitallens": {
        generatedFrom: "js/agent-core.js (validation/build_mcp_manifest.js)",
        server: "mcp/server.js — stdio MCP server exposing these tools over the same safety kernel with a simulated patient (it also adds a read-only export_session tool)",
      },
    },
    tools: A.TOOLS,
  };
}
if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, "..", "mcp", "tools.json"), JSON.stringify(manifest(), null, 2) + "\n");
  console.log("wrote mcp/tools.json");
}
module.exports = { manifest };
