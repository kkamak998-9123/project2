const TAB_COLOR_VAR = { defense: "--tab-defense", semiconductor: "--tab-semiconductor", construction: "--tab-construction" };

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ---------------------------------------------------------------- formatting
function fmtWon(v) {
  if (v == null || isNaN(v)) return "—";
  const av = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (av >= 1e12) return sign + (av / 1e12).toFixed(2) + "조";
  if (av >= 1e8) return sign + (av / 1e8).toFixed(1) + "억";
  if (av >= 1e4) return sign + (av / 1e4).toFixed(0) + "만";
  return sign + av.toFixed(0);
}
function fmtPct(v, d = 1) {
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(d) + "%";
}
function fmtX(v) {
  if (v == null || isNaN(v)) return "—";
  if (v > 999) return "999+";
  if (v < -999) return "-999+";
  return v.toFixed(2) + "x";
}
function fmtByUnit(v, unit) {
  if (unit === "won") return fmtWon(v);
  if (unit === "x") return fmtX(v);
  return fmtPct(v);
}

// ---------------------------------------------------------------- badges
const BADGE_RULES = {
  opm: [[15, "good"], [0, "warn"], [-Infinity, "bad"]],
  roe: [[10, "good"], [0, "warn"], [-Infinity, "bad"]],
  fcfMargin: [[0, "good"], [-Infinity, "bad"]],
  ocfMargin: [[0, "good"], [-Infinity, "bad"]],
  debtRatio: [[-Infinity, "good"], [100, "warn"], [200, "bad"]],
  currentRatio: [[150, "good"], [100, "warn"], [-Infinity, "bad"]],
  borrowingRatio: [[-Infinity, "good"], [30, "warn"], [50, "bad"]],
};

function badgeFor(key, v) {
  const rule = BADGE_RULES[key];
  if (!rule || v == null || isNaN(v)) return null;
  if (key === "debtRatio" || key === "borrowingRatio") {
    if (v < rule[1][0]) return "good";
    if (v < rule[2][0]) return "warn";
    return "bad";
  }
  if (key === "currentRatio") {
    if (v >= rule[0][0]) return "good";
    if (v >= rule[1][0]) return "warn";
    return "bad";
  }
  // 상승이 좋은 지표(opm/roe/fcfMargin/ocfMargin)
  if (v >= rule[0][0]) return "good";
  if (rule.length > 2 && v >= rule[1][0]) return "warn";
  return "bad";
}

function renderCell(key, v, unit) {
  const cls = badgeFor(key, v);
  const text = fmtByUnit(v, unit);
  if (cls) return `<span class="badge ${cls}">${text}</span>`;
  return text;
}

// ---------------------------------------------------------------- sparkline (경량 캔버스, 외부 라이브러리 없음)
function drawSpark(canvas, values, color) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 200, h = canvas.clientHeight || 54;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const valid = values.filter((v) => v != null && !isNaN(v));
  if (valid.length < 2) {
    ctx.fillStyle = cssVar("--text-faint");
    ctx.font = "11px sans-serif";
    ctx.fillText("데이터 부족", 6, h / 2);
    return;
  }

  const min = Math.min(...valid), max = Math.max(...valid);
  const range = (max - min) || Math.abs(max || 1);
  const padX = 6, padY = 10;
  const step = (w - padX * 2) / (values.length - 1);

  const pts = values.map((v, i) => {
    if (v == null || isNaN(v)) return null;
    const x = padX + i * step;
    const y = h - padY - ((v - min) / range) * (h - padY * 2);
    return [x, y];
  });

  const rising = valid[valid.length - 1] >= valid[0];
  const lineColor = color || (rising ? cssVar("--good") : cssVar("--bad"));

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  let started = false;
  pts.forEach((p) => {
    if (!p) return;
    if (!started) { ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]);
  });
  ctx.stroke();

  const last = pts.filter((p) => p).slice(-1)[0];
  if (last) {
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(last[0], last[1], 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- state
const state = {
  industry: null,
  industries: {},
  year: "2025",
  search: "",
  sortKey: "revenue",
  sortDir: "desc",
  rows: [],
  selected: null,
};

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------- load industries / tabs
async function initIndustries() {
  const list = await fetch("/api/industries").then((r) => r.json());
  list.forEach((ind) => { state.industries[ind.id] = ind; });

  const tabBar = document.getElementById("tab-bar");
  tabBar.innerHTML = list
    .map(
      (ind) => `
    <button data-industry="${ind.id}">
      <span class="dot" style="background:${cssVar(TAB_COLOR_VAR[ind.id] || "--accent")}"></span>
      ${ind.label}
    </button>`
    )
    .join("");
  tabBar.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => setIndustry(btn.dataset.industry));
  });

  setIndustry(list[0].id);
}

function setIndustry(industryId) {
  state.industry = industryId;
  state.selected = null;
  state.sortKey = "revenue";
  state.sortDir = "desc";

  document.querySelectorAll("#tab-bar button").forEach((b) => {
    b.classList.toggle("active", b.dataset.industry === industryId);
  });

  const cfg = state.industries[industryId];
  document.getElementById("page-title").textContent = `${cfg.label} 기업 재무비율 대시보드`;
  document.getElementById("page-sub").textContent =
    `Samil Project DB — ${cfg.label} 사업보고서 기반 재무비율`;
  document.getElementById("footerNote").innerHTML = `<p><b>참고</b> — ${cfg.note}</p>`;

  document.getElementById("detailBody").innerHTML =
    '<div class="empty-hint">왼쪽 표에서 기업을 클릭하면 상세 비율을 볼 수 있습니다.</div>';

  renderTableHead();
  fetchRatios();
}

function renderTableHead() {
  const cfg = state.industries[state.industry];
  const cols = [{ key: "name", label: "기업" }, ...cfg.table_cols];
  const thead = document.getElementById("tableHead");
  thead.innerHTML =
    "<tr>" +
    cols
      .map((c) => `<th data-key="${c.key}">${c.label}${c.key === state.sortKey ? '<span class="arrow">▾</span>' : ""}</th>`)
      .join("") +
    "</tr>";

  thead.querySelectorAll("th").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.key === state.sortKey);
    th.addEventListener("click", () => {
      if (state.sortKey === th.dataset.key) {
        state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
      } else {
        state.sortKey = th.dataset.key;
        state.sortDir = "desc";
      }
      renderTableHead();
      renderTable();
    });
  });
}

// ---------------------------------------------------------------- fetch + render table
async function fetchRatios() {
  const params = new URLSearchParams({ industry: state.industry, year: state.year, q: state.search });
  const data = await fetch(`/api/ratios?${params}`).then((r) => r.json());
  state.rows = data.items;
  renderKPIs(data.kpi);
  renderTable();
  document.getElementById("rowCount").textContent = `${data.count.toLocaleString()}개사`;
  document.getElementById("yearLabel").textContent = state.year;
}

function renderKPIs(kpi) {
  const tiles = [
    { label: "분석 대상", value: kpi.count, unit: "개사", note: "선택한 업종·연도 기준" },
    {
      label: `${state.year}년 흑자기업`,
      value: kpi.profitable_count != null ? kpi.profitable_count : "—",
      unit: kpi.profitable_count != null ? `/ ${kpi.count}` : "",
      note: "영업이익 > 0 기준",
    },
    {
      label: `${state.year}년 영업이익률 중앙값`,
      value: kpi.median_opm != null ? kpi.median_opm.toFixed(1) : "—",
      unit: "%",
      note: "",
    },
    { label: `${state.year}년 합산 매출액`, value: fmtWon(kpi.total_revenue), unit: "", note: "" },
  ];
  document.getElementById("kpiStrip").innerHTML = tiles
    .map(
      (t) => `
    <div class="kpi">
      <div class="kpi-label">${t.label}</div>
      <div class="kpi-value">${t.value}<span class="unit">${t.unit}</span></div>
      <div class="kpi-note">${t.note}</div>
    </div>`
    )
    .join("");
}

function renderTable() {
  const cfg = state.industries[state.industry];
  let rows = state.rows.slice();
  const key = state.sortKey;
  rows.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (key === "name") return String(a.corp_name).localeCompare(String(b.corp_name)) * (state.sortDir === "asc" ? 1 : -1);
    return (av - bv) * (state.sortDir === "asc" ? 1 : -1);
  });

  const tbody = document.getElementById("tableBody");
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cfg.table_cols.length + 1}" class="empty-hint">조건에 맞는 기업이 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr data-corp="${r.corp_code}" class="${state.selected === r.corp_code ? "selected" : ""}">
      <td><span class="co-name">${r.corp_name}</span><span class="co-ticker">${r.stock_code || ""}</span></td>
      ${cfg.table_cols.map((c) => `<td>${renderCell(c.key, r[c.key], c.unit)}</td>`).join("")}
    </tr>`
    )
    .join("");

  tbody.querySelectorAll("tr[data-corp]").forEach((tr) => {
    tr.addEventListener("click", () => {
      state.selected = tr.dataset.corp;
      renderTable();
      renderDetail(tr.dataset.corp);
    });
  });
}

// ---------------------------------------------------------------- detail panel
async function renderDetail(corpCode) {
  const body = document.getElementById("detailBody");
  body.innerHTML = '<div class="empty-hint">불러오는 중…</div>';

  const detail = await fetch(`/api/ratios/${state.industry}/${corpCode}`).then((r) => r.json());
  const cur = detail.latest;

  body.innerHTML = `
    <div>
      <span class="detail-name">${detail.corp_name}</span>
      <span class="detail-ticker">${detail.stock_code || ""}</span>
    </div>

    <div class="mini-charts">
      ${detail.sparks
        .map(
          (s) => `
        <div class="mini-chart">
          <div class="mc-label"><span>${s.label}</span><b>${fmtByUnit(cur[s.key], s.unit)}</b></div>
          <canvas data-key="${s.key}"></canvas>
        </div>`
        )
        .join("")}
    </div>

    <div class="metric-grid">
      ${detail.detail_cols
        .map(
          (c) => `
        <div class="metric-row">
          <span class="m-label">${c.label}</span>
          <span class="m-value">${fmtByUnit(cur[c.key], c.unit)}</span>
        </div>`
        )
        .join("")}
    </div>
  `;

  detail.sparks.forEach((s) => {
    const canvas = body.querySelector(`canvas[data-key="${s.key}"]`);
    if (canvas) requestAnimationFrame(() => drawSpark(canvas, detail.series[s.key] || []));
  });
}

// ---------------------------------------------------------------- controls
document.getElementById("searchBox").addEventListener(
  "input",
  debounce((e) => {
    state.search = e.target.value;
    fetchRatios();
  }, 250)
);

document.getElementById("yearToggle").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-year]");
  if (!btn) return;
  state.year = btn.dataset.year;
  document.querySelectorAll("#yearToggle button").forEach((b) => b.classList.toggle("active", b === btn));
  fetchRatios();
});

initIndustries();
