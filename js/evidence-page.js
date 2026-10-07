// Evidence page: gap map + the four safety-management steps with VitalLens's implementation status.
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  document.addEventListener("DOMContentLoaded", () => {
    if (window.VLCharts) window.VLCharts.renderGapMap("gap-map");
    const steps = (window.EVIDENCE && window.EVIDENCE.safety_protocol && window.EVIDENCE.safety_protocol.steps) || [];
    const root = document.getElementById("safety-steps");
    if (!root) return;
    const badge = { "구현": "badge-ok", "부분": "badge-warn", "미구현": "badge-veto" };
    steps.forEach((s, i) => {
      const el = document.createElement("div");
      el.className = "step";
      el.innerHTML = `<div class="n">${i + 1}</div><div><h3>${esc(s.step)} <span class="badge ${badge[s.status] || ""}">VitalLens: ${esc(s.status)}</span></h3><p>${esc(s.detail)}</p><p class="small" style="margin-top:6px;"><strong>현재 구현:</strong> ${esc(s.vitallens)}</p></div>`;
      root.appendChild(el);
    });
  });
})();
