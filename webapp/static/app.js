const KEY_ACCOUNTS = ["매출액", "영업이익", "당기순이익", "자산총계", "영업활동현금흐름", "부채총계"];
const SERIES_VARS = ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5", "--series-6"];
const INDUSTRY_LABELS = { defense: "방산", semiconductor: "반도체", construction: "건설" };
const INDUSTRY_ORDER = ["defense", "semiconductor", "construction"];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function seriesColor(accountName) {
  const idx = KEY_ACCOUNTS.indexOf(accountName);
  return cssVar(SERIES_VARS[idx >= 0 ? idx : 0]);
}

function industryColor(industryId) {
  const idx = INDUSTRY_ORDER.indexOf(industryId);
  return cssVar(SERIES_VARS[idx >= 0 ? idx : 0]);
}

const state = { q: "", industry: "", market: "", level: "" };
let chartInstance = null;

const rowsEl = document.getElementById("rows");
const countEl = document.getElementById("result-count");

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function loadMeta() {
  const meta = await fetch("/api/meta").then((r) => r.json());
  const statRow = document.getElementById("stat-row");
  const tiles = [
    { id: "", label: "전체 기업", n: meta.total_companies },
    ...INDUSTRY_ORDER.filter((i) => meta.industries.includes(i)).map((i) => ({
      id: i,
      label: INDUSTRY_LABELS[i],
      n: meta.industry_counts[i] || 0,
    })),
  ];
  statRow.innerHTML = tiles
    .map(
      (t) => `
    <div class="stat-tile">
      <div class="n">${t.n.toLocaleString()}</div>
      <div class="label">${t.id ? `<span class="dot" style="background:${industryColor(t.id)}"></span>` : ""}${t.label}</div>
    </div>`
    )
    .join("");
}

async function fetchCompanies() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.industry) params.set("industry", state.industry);
  if (state.market) params.set("market", state.market);
  if (state.level) params.set("level", state.level);

  const res = await fetch(`/api/companies?${params}`);
  const data = await res.json();
  renderTable(data);
}

function industryBadges(industries) {
  if (!industries || industries.length === 0) return "";
  return industries
    .map(
      (i) =>
        `<span class="badge ${i.industry_id}"><span class="dot"></span>${i.industry_label} ${i.level}</span>`
    )
    .join("");
}

function renderTable(data) {
  countEl.textContent = `${data.count.toLocaleString()}개 기업`;

  if (data.count === 0) {
    rowsEl.innerHTML = `<tr class="empty-row"><td colspan="5">조건에 맞는 기업이 없습니다.</td></tr>`;
    return;
  }

  rowsEl.innerHTML = data.items
    .map(
      (c) => `
    <tr data-corp="${c.corp_code}">
      <td class="name-cell">${c.corp_name}</td>
      <td>${c.market || "-"}</td>
      <td>${c.ksic_name || "-"}</td>
      <td>${industryBadges(c.industries)}</td>
      <td class="memo-cell" title="${(c.memo || "").replace(/"/g, "&quot;")}">${c.memo || ""}</td>
    </tr>`
    )
    .join("");

  rowsEl.querySelectorAll("tr[data-corp]").forEach((tr) => {
    tr.addEventListener("click", () => openDetail(tr.dataset.corp));
  });
}

async function openDetail(corpCode) {
  const overlay = document.getElementById("detail-overlay");
  overlay.classList.add("open");
  document.getElementById("detail-name").textContent = "불러오는 중...";
  document.getElementById("detail-sub").textContent = "";
  document.getElementById("detail-body").innerHTML = '<div class="spinner"></div>';

  const [company, financials] = await Promise.all([
    fetch(`/api/companies/${corpCode}`).then((r) => r.json()),
    fetch(`/api/financials/${corpCode}`).then((r) => r.json()),
  ]);

  document.getElementById("detail-name").textContent = company.corp_name;
  document.getElementById("detail-sub").textContent =
    [company.market, company.ksic_name, company.memo].filter(Boolean).join(" · ");

  const body = document.getElementById("detail-body");

  if (!financials.chart || financials.chart.length === 0) {
    body.innerHTML = '<div class="empty-state">등록된 재무 데이터가 없습니다.</div>';
    return;
  }

  body.innerHTML = `<div class="chart-wrap"><canvas id="fin-chart"></canvas></div>`;
  renderChart(financials.chart);
}

function renderChart(chartRows) {
  const years = [...new Set(chartRows.map((r) => r.year))].sort();
  const accounts = KEY_ACCOUNTS.filter((a) =>
    chartRows.some((r) => r.account_name === a)
  );

  const datasets = accounts.map((account) => ({
    label: account,
    data: years.map((y) => {
      const row = chartRows.find((r) => r.year === y && r.account_name === account);
      return row ? row.amount_num : null;
    }),
    borderColor: seriesColor(account),
    backgroundColor: seriesColor(account),
    borderWidth: 2,
    pointRadius: 3,
    pointHoverRadius: 5,
    tension: 0.15,
    spanGaps: true,
  }));

  if (chartInstance) chartInstance.destroy();
  const ctx = document.getElementById("fin-chart").getContext("2d");
  chartInstance = new Chart(ctx, {
    type: "line",
    data: { labels: years, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: cssVar("--text-secondary"), usePointStyle: true, boxWidth: 8 },
        },
        tooltip: {
          backgroundColor: cssVar("--surface-1"),
          titleColor: cssVar("--text-primary"),
          bodyColor: cssVar("--text-secondary"),
          borderColor: cssVar("--border"),
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString()}원`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: cssVar("--gridline") },
          ticks: { color: cssVar("--text-muted") },
        },
        y: {
          grid: { color: cssVar("--gridline") },
          ticks: {
            color: cssVar("--text-muted"),
            callback: (v) => Number(v).toLocaleString(),
          },
        },
      },
    },
  });
}

document.getElementById("q").addEventListener(
  "input",
  debounce((e) => {
    state.q = e.target.value;
    fetchCompanies();
  }, 250)
);
document.getElementById("industry").addEventListener("change", (e) => {
  state.industry = e.target.value;
  fetchCompanies();
});
document.getElementById("market").addEventListener("change", (e) => {
  state.market = e.target.value;
  fetchCompanies();
});
document.getElementById("level").addEventListener("change", (e) => {
  state.level = e.target.value;
  fetchCompanies();
});

document.getElementById("close-detail").addEventListener("click", () => {
  document.getElementById("detail-overlay").classList.remove("open");
});
document.getElementById("detail-overlay").addEventListener("click", (e) => {
  if (e.target.id === "detail-overlay") e.target.classList.remove("open");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.getElementById("detail-overlay").classList.remove("open");
});

loadMeta();
fetchCompanies();
