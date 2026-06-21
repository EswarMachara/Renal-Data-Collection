import { state } from "./state.js";
import { authedFetch, handle401 } from "./api.js";
import { escapeHTML } from "./utils.js";

function subFormatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function subUploadMode(mode) {
  if (mode === "clinical_document") return "Clinical Document";
  return mode === "package" ? "Patient Package" : "Separate Files";
}

function ckdStatusCounts(items) {
  const counts = { Yes: 0, No: 0 };
  (items || []).forEach((item) => {
    const label = String(item.label ?? item.stage ?? "").trim();
    const value = Number(item.value ?? item.count ?? 0);
    if (!value) return;
    if (label === "No" || label === "Normal") counts.No += value;
    else counts.Yes += value;
  });
  return counts;
}

const CKD_STATUS_DONUT_SEGMENTS = (counts) => [
  { label: "CKD: Yes", value: counts.Yes || 0, color: "#0f9a87" },
  { label: "CKD: No", value: counts.No || 0, color: "#94a3b8" }
];

function chartColorClass(color) {
  const classes = {
    "#0f9a87": "chart-color-teal",
    "#2dd4bf": "chart-color-mint",
    "#60a5fa": "chart-color-blue-light",
    "#fbbf24": "chart-color-yellow",
    "#f97316": "chart-color-orange",
    "#f87171": "chart-color-red-light",
    "#dc2626": "chart-color-red",
    "#8b5cf6": "chart-color-violet",
    "#2563eb": "chart-color-blue",
    "#cbd5e1": "chart-color-slate-light",
    "#94a3b8": "chart-color-slate",
    "#3b82f6": "chart-color-azure",
    "#f59e0b": "chart-color-amber",
    "#6366f1": "chart-color-indigo",
    "#10b981": "chart-color-green",
    "#ef4444": "chart-color-coral",
    "#14b8a6": "chart-color-turquoise"
  };
  return classes[color] || "chart-color-slate";
}

export function refreshDashboard() {
  updateDashboards();
  redrawRecentUploads();
}

export async function loadBackendDashboard() {
  if (window.location.protocol === "file:") return;
  try {
    const response = await authedFetch("/api/dashboard-summary", { cache: "no-store" });
    if (response.status === 401) { handle401(); return; }
    const result = await response.json();
    if (response.ok && result.ok && result.summary) {
      state.backendDashboard = result.summary;
      refreshDashboard();
    }
  } catch { /* network error — silently skip */ }
}

function redrawRecentUploads() {
  const recentBody = document.getElementById("recent-body");
  if (!recentBody || (state.authSession?.role === "admin" && state.backendDashboard)) return;
  recentBody.innerHTML = "";

  if (!state.recentUploads?.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="7" class="empty">No uploads completed in this session.</td>';
    recentBody.appendChild(row);
    return;
  }

  state.recentUploads.slice(0, 8).forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHTML(item.batchId)}</td>
      <td>${escapeHTML(item.hospitalId)}</td>
      <td>${escapeHTML(item.uhid)}</td>
      <td>${escapeHTML(subUploadMode(item.uploadMode))}</td>
      <td>${item.files.map(escapeHTML).join(", ")}</td>
      <td>${escapeHTML(item.gcsPath || item.localPath || "-")}</td>
      <td>${escapeHTML(item.status)}</td>
    `;
    recentBody.appendChild(row);
  });
}

export function updateDashboards() {
  const d = state.backendDashboard;
  const role = state.authSession?.role;
  const adminView = document.getElementById("dash-admin-view");
  const hospView = document.getElementById("dash-hospital-view");
  if (adminView) adminView.classList.toggle("hidden", role !== "admin");
  if (hospView) hospView.classList.toggle("hidden", role === "admin");

  if (!d) return;

  const nowStr = `Last updated: ${new Date().toLocaleTimeString()}`;

  if (role === "admin") {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const emptyPathway = {
      summary: { patients: 0, videos: 0, documents: 0, pending: 0 },
      stages: [],
      diabetic: [],
      ageBuckets: [],
      followUp: [],
      kidneyFailureEvents: [],
      recentRecords: []
    };
    const egfr = d.pathways?.egfr || { ...emptyPathway, ...d, summary: d.summary || emptyPathway.summary };
    const kfre = d.pathways?.kfre || emptyPathway;
    const currentView = state.adminDashboardView === "egfr" || state.adminDashboardView === "kfre"
      ? state.adminDashboardView
      : "overview";

    set("summary-hospitals", d.summary?.hospitals ?? 0);
    set("summary-egfr-records", egfr.summary?.patients ?? 0);
    set("summary-kfre-records", kfre.summary?.patients ?? 0);
    set("admin-egfr-tab-count", egfr.summary?.patients ?? 0);
    set("admin-kfre-tab-count", kfre.summary?.patients ?? 0);
    const updEl = document.getElementById("dashboard-updated-at");
    if (updEl) updEl.textContent = nowStr;

    document.querySelectorAll("[data-admin-dashboard-view]").forEach((button) => {
      const isActive = button.dataset.adminDashboardView === currentView;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("tabindex", isActive ? "0" : "-1");
    });
    document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
      const panelView = panel.dataset.adminPanel;
      panel.classList.toggle("visible", panelView === currentView || (panelView === "study" && currentView !== "overview"));
    });

    renderHospitalBreakdown(d.hospitalBreakdown || [], d.summary?.patients || 0);
    if (currentView === "overview") return;

    const pathway = currentView === "kfre" ? kfre : egfr;
    const isKfre = currentView === "kfre";
    const studyHeader = document.getElementById("admin-study-header");
    studyHeader?.classList.toggle("is-kfre", isKfre);
    set("admin-study-badge", isKfre ? "KFRE STUDY" : "eGFR STUDY");
    set("admin-study-title", isKfre ? "Kidney Failure Risk Assessment" : "Ultrasound and Clinical Intake");
    set("admin-study-description", isKfre
      ? "Clinical document submissions with prospective follow-up and outcome labels."
      : "Kidney ultrasound imaging and associated clinical submissions.");
    set("study-summary-records", pathway.summary?.patients ?? 0);
    const kfreFollowUpCount = (pathway.followUp || []).find((item) => item.label === "Recorded")?.value || 0;
    set("study-summary-files", isKfre ? kfreFollowUpCount : pathway.summary?.videos ?? 0);
    set("study-summary-files-label", isKfre ? "FOLLOW-UP RECORDS" : "ULTRASOUND VIDEOS");
    set("study-summary-pending", pathway.summary?.patients ?? 0);
    set("admin-stage-title", isKfre ? "KFRE CKD Status" : "Chronic Kidney Disease Status");
    set("admin-secondary-title", isKfre ? "Prospective Follow-up" : "Age Distribution");
    set("admin-secondary-note", isKfre ? "Follow-up information recorded" : "Adults 18+, with 80+ grouped");
    set("admin-tertiary-title", isKfre ? "Kidney Failure Events" : "CKD Diabetic vs Non-Diabetic");
    set("admin-recent-title", isKfre ? "Recent KFRE Records" : "Recent eGFR Records");
    set("admin-recent-note", isKfre
      ? "Latest clinical document submissions across all hospitals"
      : "Latest eGFR submissions across all hospitals");

    const stageCounts = ckdStatusCounts(pathway.stages);
    const total = pathway.summary?.patients || 0;
    renderDonut("ckd-stage-donut", "ckd-stage-center", "ckd-stage-legend",
      CKD_STATUS_DONUT_SEGMENTS(stageCounts), String(total));

    const ageHistogram = document.getElementById("age-histogram");
    const followupWidget = document.getElementById("kfre-followup-widget");
    ageHistogram?.classList.toggle("hidden", isKfre);
    followupWidget?.classList.toggle("hidden", !isKfre);
    if (isKfre) {
      const followUp = Object.fromEntries((pathway.followUp || []).map((item) => [item.label, item.value]));
      renderDonut("kfre-followup-donut", "kfre-followup-center", "kfre-followup-legend", [
        { label: "Follow-up Recorded", value: followUp.Recorded || 0, color: "#2563eb" },
        { label: "Baseline Only", value: followUp["Baseline Only"] || 0, color: "#cbd5e1" }
      ], String(total));
      const eventCounts = Object.fromEntries((pathway.kidneyFailureEvents || []).map((item) => [item.label, item.value]));
      renderDonut("diabetic-donut", "diabetic-center", "diabetic-legend", [
        { label: "Event Recorded", value: eventCounts.Yes || 0, color: "#dc2626" },
        { label: "No Event Recorded", value: eventCounts.No || 0, color: "#2563eb" }
      ], String(total));
    } else {
      const ageBuckets = (pathway.ageBuckets || []).map((bucket) => ({ label: bucket.bucket, value: bucket.count }));
      renderHistogram("age-histogram", ageBuckets);
      const diabYes = (pathway.diabetic || []).find((item) => item.label === "Yes")?.value || 0;
      const diabNo = (pathway.diabetic || []).find((item) => item.label === "No")?.value || 0;
      renderDonut("diabetic-donut", "diabetic-center", "diabetic-legend", [
        { label: "CKD Diabetic", value: diabYes, color: "#0f9a87" },
        { label: "CKD Non-Diabetic", value: diabNo, color: "#94a3b8" }
      ]);
    }

    renderRecentRecordsTable("recent-body", pathway.recentRecords || [], ["uhid", "hospitalId", "uploadMode", "receivedAt", "reviewedAt"]);
  } else {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("hosp-summary-patients", d.summary?.patients ?? 0);
    set("hosp-summary-videos", d.summary?.videos ?? 0);
    set("hosp-summary-pending", d.summary?.patients ?? 0);

    const subtitleEl = document.getElementById("dash-hospital-subtitle");
    const hospName = state.authSession?.hospitalName || state.authSession?.hospitalId || "";
    if (subtitleEl && hospName) subtitleEl.textContent = `Submitted patient records and cloud storage activity for ${hospName}`;

    const updEl = document.getElementById("dash-hospital-updated");
    if (updEl) updEl.textContent = nowStr;

    const stageCounts = ckdStatusCounts(d.stages);
    const total = d.summary?.patients || 0;
    renderDonut("hosp-ckd-donut", "hosp-ckd-center", "hosp-ckd-legend",
      CKD_STATUS_DONUT_SEGMENTS(stageCounts), String(total));

    const ageBuckets = (d.ageBuckets || []).map((bucket) => ({ label: bucket.bucket, value: bucket.count }));
    renderHistogram("hosp-age-histogram", ageBuckets);
    renderRecentRecordsTable("hosp-recent-body", d.recentRecords || [], ["uhid", "uploadMode", "receivedAt", "reviewedAt"]);
  }
}

export function renderHospitalBreakdown(breakdown, grandTotal) {
  const grid = document.getElementById("hosp-breakdown-grid");
  const note = document.getElementById("hosp-breakdown-note");
  if (!grid) return;

  const maxPatients = Math.max(...breakdown.map((hospital) => hospital.patients), 1);
  const totalWithData = breakdown.filter((hospital) => hospital.patients > 0).length;
  if (note) note.textContent = `${totalWithData} of ${breakdown.length} hospitals have submitted records`;

  if (!breakdown.length) {
    grid.innerHTML = '<p class="empty">No data yet.</p>';
    return;
  }

  grid.innerHTML = breakdown.map((hospital) => {
    const pct = grandTotal > 0 ? Math.round((hospital.patients / grandTotal) * 100) : 0;
    const egfrPatients = hospital.egfrPatients ?? hospital.patients;
    const kfrePatients = hospital.kfrePatients ?? 0;
    const egfrWidth = egfrPatients ? Math.max(Math.round((egfrPatients / maxPatients) * 100), 2) : 0;
    const kfreWidth = kfrePatients ? Math.max(Math.round((kfrePatients / maxPatients) * 100), 2) : 0;
    return `
      <div class="hosp-breakdown-card ${hospital.patients === 0 ? "hosp-card-empty" : ""}">
        <div class="hosp-card-header">
          <div>
            <span class="hosp-card-id">${escapeHTML(hospital.hospitalId)}</span>
            <span class="hosp-card-name">${escapeHTML(hospital.hospitalName)}</span>
          </div>
          <span class="hosp-card-count">${hospital.patients} record${hospital.patients !== 1 ? "s" : ""}</span>
        </div>
        <div class="hosp-pathway-totals">
          <div class="hosp-pathway-total"><span>eGFR</span><strong>${egfrPatients}</strong></div>
          <div class="hosp-pathway-total kfre"><span>KFRE</span><strong>${kfrePatients}</strong></div>
        </div>
        <div class="hosp-bar-track">
          <svg class="hosp-bar-chart" viewBox="0 0 100 7" preserveAspectRatio="none" aria-hidden="true">
            ${egfrPatients ? `<rect class="hosp-bar-fill" x="0" y="0" width="${egfrWidth}" height="7" rx="3.5"></rect>` : ""}
            ${kfrePatients ? `<rect class="hosp-bar-fill kfre" x="${egfrWidth}" y="0" width="${kfreWidth}" height="7" rx="3.5"></rect>` : ""}
          </svg>
        </div>
        <div class="hosp-card-meta">
          <span class="hosp-meta-chip hosp-meta-pct">${pct}% of total</span>
          <span class="hosp-meta-chip hosp-meta-review">${hospital.patients} stored</span>
        </div>
      </div>`;
  }).join("");
}

export function renderRecentRecordsTable(tbodyId, records, cols) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  if (!records.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" class="empty">No records yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = records.map((record) => {
    const cells = cols.map((column) => {
      if (column === "receivedAt") return `<td class="sub-date">${subFormatDate(record.receivedAt)}</td>`;
      if (column === "reviewedAt") return `<td><span class="sub-badge sub-badge-reviewed">Stored</span></td>`;
      if (column === "uploadMode") return `<td>${escapeHTML(subUploadMode(record.uploadMode))}</td>`;
      return `<td>${escapeHTML(String(record[column] || "—"))}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
}

function renderDonut(donutId, centerId, legendId, segments, centerValue) {
  const donut = document.getElementById(donutId);
  const center = document.getElementById(centerId);
  const legend = document.getElementById(legendId);
  if (!donut || !center || !legend) return;

  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  let current = 0;
  const circles = segments.map((segment) => {
    const portion = (segment.value / total) * 100;
    const offset = -((current / total) * 100);
    current += segment.value;
    return `<circle class="donut-segment ${chartColorClass(segment.color)}" cx="50" cy="50" r="46" pathLength="100" stroke-dasharray="${portion} 100" stroke-dashoffset="${offset}"></circle>`;
  }).join("");
  donut.classList.add("has-svg-chart");
  donut.innerHTML = `
    <svg class="donut-chart" viewBox="0 0 100 100" aria-hidden="true">
      <circle class="donut-track" cx="50" cy="50" r="46"></circle>
      ${circles}
    </svg>
  `;
  center.textContent = centerValue ?? `${Math.round((segments[0].value / total) * 100)}%`;
  legend.innerHTML = "";
  segments.forEach((segment) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <span class="legend-dot ${chartColorClass(segment.color)}"></span>
      <span>${segment.label} (${segment.value})</span>
    `;
    legend.appendChild(item);
  });
}

function renderHistogram(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!items.length) {
    container.innerHTML = "<p class=\"empty\">No data available.</p>";
    return;
  }

  const palette = ["#0f9a87", "#3b82f6", "#f59e0b", "#6366f1", "#10b981", "#ef4444", "#14b8a6", "#8b5cf6"];
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  container.innerHTML = "";
  items.forEach((item, index) => {
    const column = document.createElement("div");
    column.className = "histogram-col";
    const height = Math.round(Math.max((item.value / maxValue) * 160, 18));
    column.innerHTML = `
      <div class="histogram-value">${item.value}</div>
      <svg class="histogram-bar" viewBox="0 0 42 ${height}" height="${height}" preserveAspectRatio="none" aria-hidden="true">
        <rect class="${chartColorClass(palette[index % palette.length])}" x="0" y="0" width="42" height="${height}" rx="6"></rect>
      </svg>
      <div class="histogram-label">${item.label}</div>
    `;
    container.appendChild(column);
  });
}
