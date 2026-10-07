// Renders the disease x technology "evidence gap map" as an accessible bar chart
// (direct labels + legend + table fallback, per dataviz palette/contrast rules).
(function () {
  function renderGapMap(rootId) {
    const root = document.getElementById(rootId);
    if (!root || !window.EVIDENCE) return;
    const d = window.EVIDENCE.evidence_tech_map;
    const max = Math.max(...d.cardiac, ...d.pulmonary);

    // sort axes by combined total, descending
    const order = d.columns.map((c, i) => i).sort((a, b) => (d.cardiac[b] + d.pulmonary[b]) - (d.cardiac[a] + d.pulmonary[a]));

    const legend = document.createElement("div");
    legend.className = "chart-legend";
    legend.innerHTML = `
      <span><span class="legend-dot" style="background:var(--cardiac)"></span>심장재활</span>
      <span><span class="legend-dot" style="background:var(--pulmonary)"></span>호흡재활</span>`;

    const toolbar = document.createElement("div");
    toolbar.className = "chart-toolbar";
    toolbar.innerHTML = `<button class="table-toggle-btn" type="button" aria-pressed="false">표로 보기</button>`;

    const list = document.createElement("div");
    list.className = "barlist";

    order.forEach((i) => {
      const name = d.columns[i];
      const group = document.createElement("div");
      group.className = "gap-group";
      group.style.marginBottom = "10px";
      const heading = document.createElement("div");
      heading.style.cssText = "font-size:12.5px; font-weight:700; color:var(--text-primary); margin-bottom:4px;";
      heading.textContent = name;
      group.appendChild(heading);

      [
        { tag: "심장", val: d.cardiac[i], color: "var(--cardiac)" },
        { tag: "호흡", val: d.pulmonary[i], color: "var(--pulmonary)" },
      ].forEach((row) => {
        const el = document.createElement("div");
        el.className = "barrow";
        el.style.gridTemplateColumns = "46px 1fr 40px";
        const pct = Math.max(2, Math.round((row.val / max) * 100));
        el.innerHTML = `
          <span class="name">${row.tag}</span>
          <span class="bartrack" title="${name} · ${row.tag}: ${row.val}건"><span class="barfill" style="width:${pct}%; background:${row.color}"></span></span>
          <span class="val">${row.val}</span>`;
        group.appendChild(el);
      });
      list.appendChild(group);
    });

    const table = document.createElement("table");
    table.className = "evidence-table";
    table.innerHTML = `<caption class="sr-only">질환군 × 기술요소 문헌 수</caption><thead><tr><th scope="col">기술 요소</th><th scope="col">심장재활 (건)</th><th scope="col">호흡재활 (건)</th></tr></thead>
      <tbody>${order.map((i) => `<tr><td>${d.columns[i]}</td><td>${d.cardiac[i]}</td><td>${d.pulmonary[i]}</td></tr>`).join("")}</tbody>`;

    root.appendChild(legend);
    root.appendChild(toolbar);
    root.appendChild(list);
    root.appendChild(table);

    toolbar.querySelector("button").addEventListener("click", (e) => {
      const showing = table.classList.toggle("show");
      list.style.display = showing ? "none" : "";
      e.target.textContent = showing ? "차트로 보기" : "표로 보기";
      e.target.setAttribute("aria-pressed", String(showing));
    });
  }

  window.VLCharts = { renderGapMap };
})();
