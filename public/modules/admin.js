import { state } from "./state.js";
import { authedFetch, handle401 } from "./api.js";
import { showToast, escapeHTML } from "./utils.js";

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiGet(path) {
  try {
    const res = await authedFetch(path);
    if (res.status === 401) { handle401(); return { ok: false }; }
    const payload = await res.json();
    if (!payload.ok && payload.error) showToast(payload.error);
    return payload;
  } catch {
    showToast("Admin portal could not connect to the server.");
    return { ok: false };
  }
}

async function apiReq(path, body, method = "POST") {
  try {
    const res = await authedFetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) { handle401(); return { ok: false }; }
    return res.json();
  } catch { return { ok: false }; }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(" ");
}

function subUploadMode(mode) {
  if (mode === "clinical_document") return "Clinical Document";
  return mode === "package" ? "Patient Package" : "Separate Files";
}

// Apply bar widths via JS after innerHTML so no inline style= is in HTML
function applyBarWidths(container) {
  container.querySelectorAll("[data-pct]").forEach((el) => {
    el.style.width = `${el.dataset.pct}%`;
  });
}

// ── Module state ──────────────────────────────────────────────────────────────
let activeSection = "overview";
let adminHospitals = [];
let modalConfirmFn = null;
let initialized = false;
let logoutCallback = () => {};

export function setAdminLogoutCallback(fn) {
  logoutCallback = fn;
}

// ── Section navigation ────────────────────────────────────────────────────────
const SECTION_TITLES = {
  overview: "Overview",
  hospitals: "Hospitals",
  submissions: "Patient Records",
  audit: "Audit Log",
  analytics: "Analytics",
  system: "System Health",
};

function navigate(section) {
  document.querySelectorAll(".admin-section").forEach((el) => el.classList.add("hidden"));
  document.getElementById(`admin-section-${section}`)?.classList.remove("hidden");
  document.querySelectorAll(".admin-nav-btn").forEach((btn) => {
    const active = btn.dataset.section === section;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-current", active ? "page" : "false");
  });
  const titleEl = document.getElementById("admin-page-title");
  if (titleEl) titleEl.textContent = SECTION_TITLES[section] ?? section;
  activeSection = section;
  loadSection(section);
}

function loadSection(section) {
  switch (section) {
    case "overview":    loadOverview();    break;
    case "hospitals":   loadHospitals();   break;
    case "submissions": loadAdminSubs();   break;
    case "audit":       loadAudit();       break;
    case "analytics":   loadAnalytics();   break;
    case "system":      loadSystem();      break;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function showAdminPortal() {
  document.getElementById("admin-portal")?.classList.remove("hidden");
  const label = document.getElementById("admin-user-label");
  if (label) label.textContent = state.authSession?.userId ?? "Administrator";
  loadHospitals();
  navigate("overview");
}

export function hideAdminPortal() {
  document.getElementById("admin-portal")?.classList.add("hidden");
  closeModal();
}

export function initAdminPortal() {
  if (initialized) return;
  initialized = true;

  // Nav buttons
  document.querySelectorAll(".admin-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.section));
  });

  // Logout
  document.getElementById("admin-logout-btn")?.addEventListener("click", () => logoutCallback());

  // Topbar refresh
  document.getElementById("admin-refresh-btn")?.addEventListener("click", () => loadSection(activeSection));

  // Hospitals
  document.getElementById("add-hospital-btn")?.addEventListener("click", showAddHospitalModal);
  document.getElementById("hospital-search")?.addEventListener("input", (e) => renderHospitalsTable(e.target.value));
  document.getElementById("hospitals-table-wrap")?.addEventListener("click", handleHospitalClick);

  // Submissions
  document.getElementById("admin-sub-search")?.addEventListener("input", () => loadAdminSubs(1));
  document.getElementById("admin-sub-hospital-filter")?.addEventListener("change", () => loadAdminSubs(1));
  document.getElementById("admin-export-btn")?.addEventListener("click", doExportCsv);
  document.getElementById("admin-sub-table-wrap")?.addEventListener("click", handleSubmissionClick);
  document.getElementById("admin-sub-hospital-cards")?.addEventListener("click", handleSubmissionClick);

  // Audit
  document.getElementById("audit-filter-btn")?.addEventListener("click", () => loadAudit(1));

  // Analytics
  document.getElementById("reload-analytics-btn")?.addEventListener("click", loadAnalytics);
  document.getElementById("trend-days")?.addEventListener("change", loadAnalytics);

  // System
  document.getElementById("reload-system-btn")?.addEventListener("click", loadSystem);
  document.getElementById("sessions-table-wrap")?.addEventListener("click", handleSessionClick);

  // Modal
  document.getElementById("admin-modal-cancel")?.addEventListener("click", closeModal);
  document.getElementById("admin-modal-confirm")?.addEventListener("click", () => modalConfirmFn?.());
  document.getElementById("admin-modal-overlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
}

// ── Overview ──────────────────────────────────────────────────────────────────
async function loadOverview() {
  let [summary, auditResult] = await Promise.all([
    apiGet("/api/admin/analytics/summary"),
    apiGet("/api/admin/audit?limit=8"),
  ]);
  if (!summary.ok) {
    const fallback = await apiGet("/api/dashboard-summary");
    if (fallback.ok && fallback.summary) {
      summary = {
        ok: true,
        total_hospitals: fallback.summary.hospitals,
        active_hospitals: fallback.summary.hospitals,
        total_submissions: fallback.summary.patients,
        submissions_today: "—",
        submissions_this_week: "—",
        submissions_this_month: "—",
        active_sessions: state.authSession ? 1 : 0
      };
    }
  }

  const grid = document.getElementById("admin-stat-grid");
  if (grid && summary.ok) {
    grid.innerHTML = [
      { label: "Partner Hospitals",  value: summary.total_hospitals,       accent: false },
      { label: "Enabled Accounts",   value: summary.active_hospitals,      accent: true  },
      { label: "Patient Records",    value: summary.total_submissions,     accent: false },
      { label: "Records Today",      value: summary.submissions_today,     accent: true  },
      { label: "Last 7 Days",        value: summary.submissions_this_week, accent: false },
      { label: "Last 30 Days",       value: summary.submissions_this_month,accent: false },
      { label: "Active Sessions",    value: summary.active_sessions,       accent: false },
    ].map((c) => `<div class="admin-stat-card${c.accent ? " accent" : ""}">
      <div class="admin-stat-label">${escapeHTML(c.label)}</div>
      <div class="admin-stat-value">${c.value ?? "—"}</div>
    </div>`).join("");
  }

  const auditWrap = document.getElementById("admin-recent-audit");
  if (auditWrap) {
    auditWrap.innerHTML = (auditResult.ok && auditResult.logs?.length)
      ? buildAuditTable(auditResult.logs, false)
      : `<p class="admin-empty">No recent activity.</p>`;
  }

  const sysRes = await apiGet("/api/admin/system");
  const sysWrap = document.getElementById("admin-system-quick");
  if (sysWrap && sysRes.ok) {
    const rows = [
      ["Database",    sysRes.db_ready       ? "Connected"      : "Disconnected", sysRes.db_ready],
      ["GCS Storage", sysRes.gcs_configured ? "Configured"     : "Not configured", sysRes.gcs_configured],
      ["Node.js",     sysRes.node_version,   true],
      ["Uptime",      fmtUptime(sysRes.uptime_seconds), true],
      ["Memory",      `${sysRes.memory_rss_mb} MB`, true],
    ];
    if (!sysRes.db_ready && sysRes.db_reason) {
      rows.push(["DB Note", sysRes.db_reason, false]);
    }
    sysWrap.innerHTML = rows.map(([label, val, ok]) => `<div class="admin-system-row">
      <span>${escapeHTML(String(label))}</span>
      <span class="${ok ? "status-ok" : "status-warn"}">${escapeHTML(String(val ?? "—"))}</span>
    </div>`).join("");
  }
}

// ── Hospitals ─────────────────────────────────────────────────────────────────
async function loadHospitals() {
  const res = await apiGet("/api/admin/hospitals");
  if (!res.ok) { showToast("Failed to load hospitals"); return; }
  adminHospitals = res.hospitals ?? [];
  renderHospitalsTable(document.getElementById("hospital-search")?.value || "");
  populateHospitalDropdowns();
}

function renderHospitalsTable(filter = "") {
  const wrap = document.getElementById("hospitals-table-wrap");
  if (!wrap) return;
  const list = filter
    ? adminHospitals.filter((h) => h.name.toLowerCase().includes(filter.toLowerCase()))
    : adminHospitals;

  if (!list.length) {
    wrap.innerHTML = `<p class="admin-empty">No hospitals found.</p>`;
    return;
  }

  wrap.innerHTML = `<table class="admin-table">
    <thead><tr>
      <th>Hospital Name</th><th>Status</th><th>Submissions</th><th>Last Login</th><th>Created</th><th>Actions</th>
    </tr></thead>
    <tbody>
      ${list.map((h) => `<tr>
        <td><strong>${escapeHTML(h.name)}</strong></td>
        <td><span class="admin-badge ${h.active ? "admin-badge-active" : "admin-badge-inactive"}">${h.active ? "Active" : "Inactive"}</span></td>
        <td>${h.submission_count ?? 0}</td>
        <td class="admin-nowrap">${fmtDate(h.last_login_at)}</td>
        <td class="admin-nowrap">${fmtDate(h.created_at)}</td>
        <td class="actions">
          <button class="admin-btn admin-btn-outline admin-btn-sm"
            data-action="edit" data-id="${escapeHTML(h.id)}" data-name="${escapeHTML(h.name)}" type="button">Edit</button>
          <button class="admin-btn admin-btn-outline admin-btn-sm"
            data-action="reset-pw" data-id="${escapeHTML(h.id)}" data-name="${escapeHTML(h.name)}" type="button">Reset PW</button>
          <button class="admin-btn ${h.active ? "admin-btn-danger" : "admin-btn-outline"} admin-btn-sm"
            data-action="toggle-active" data-id="${escapeHTML(h.id)}" data-name="${escapeHTML(h.name)}" data-active="${h.active}" type="button">
            ${h.active ? "Deactivate" : "Activate"}
          </button>
        </td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function handleHospitalClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, id, name, active } = btn.dataset;
  if (action === "edit")          editHospital(id, name);
  else if (action === "reset-pw") resetPassword(id, name);
  else if (action === "toggle-active") toggleActive(id, name, active === "true");
}

function populateHospitalDropdowns() {
  ["admin-sub-hospital-filter", "audit-hospital-filter"].forEach((selId) => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
    adminHospitals.forEach((h) => {
      const o = document.createElement("option");
      o.value = h.id;
      o.textContent = h.name;
      sel.appendChild(o);
    });
  });
}

function showAddHospitalModal() {
  openModal("Add Hospital",
    `<div class="admin-field">
       <label>Hospital Name</label>
       <input id="m-hosp-name" maxlength="100" placeholder="e.g. Apollo Hospital Chennai" autocomplete="off">
     </div>
     <div class="admin-field">
       <label>Password (min 12 characters)</label>
       <input id="m-hosp-pw" type="password" autocomplete="new-password">
     </div>`,
    async () => {
      const name = document.getElementById("m-hosp-name")?.value.trim();
      const pw   = document.getElementById("m-hosp-pw")?.value;
      if (!name)            return showToast("Name is required");
      if (!pw || pw.length < 12) return showToast("Password must be at least 12 characters");
      const r = await apiReq("/api/admin/hospitals", { name, password: pw });
      if (r.ok) { closeModal(); showToast("Hospital added"); loadHospitals(); }
      else showToast(r.error || "Failed to add hospital");
    }
  );
}

function editHospital(id, name) {
  openModal("Edit Hospital",
    `<div class="admin-field">
       <label>Hospital Name</label>
       <input id="m-edit-name" value="${escapeHTML(name)}" maxlength="100" autocomplete="off">
     </div>`,
    async () => {
      const newName = document.getElementById("m-edit-name")?.value.trim();
      if (!newName) return showToast("Name is required");
      const r = await apiReq(`/api/admin/hospitals/${encodeURIComponent(id)}`, { name: newName }, "PATCH");
      if (r.ok) { closeModal(); showToast("Hospital updated"); loadHospitals(); }
      else showToast(r.error || "Update failed");
    }
  );
}

function resetPassword(id, name) {
  openModal(`Reset Password — ${escapeHTML(name)}`,
    `<div class="admin-field">
       <label>New Password (min 12 characters)</label>
       <input id="m-pw1" type="password" autocomplete="new-password">
     </div>
     <div class="admin-field">
       <label>Confirm Password</label>
       <input id="m-pw2" type="password" autocomplete="new-password">
     </div>`,
    async () => {
      const pw  = document.getElementById("m-pw1")?.value;
      const pw2 = document.getElementById("m-pw2")?.value;
      if (!pw || pw.length < 12) return showToast("Password must be at least 12 characters");
      if (pw !== pw2)             return showToast("Passwords do not match");
      const r = await apiReq(`/api/admin/hospitals/${encodeURIComponent(id)}/reset-password`, { newPassword: pw });
      if (r.ok) { closeModal(); showToast("Password reset — active sessions for this hospital have been logged out", 4000); }
      else showToast(r.error || "Reset failed");
    }
  );
}

function toggleActive(id, name, currentlyActive) {
  const verb = currentlyActive ? "Deactivate" : "Activate";
  openModal(`${verb} Hospital`,
    `<p>${currentlyActive ? "Deactivating" : "Activating"} <strong>${escapeHTML(name)}</strong>.
     ${currentlyActive ? "They will no longer be able to log in." : "They will regain login access."}</p>`,
    async () => {
      const r = await apiReq(`/api/admin/hospitals/${encodeURIComponent(id)}`, { active: !currentlyActive }, "PATCH");
      if (r.ok) { closeModal(); showToast(`Hospital ${verb.toLowerCase()}d`); loadHospitals(); }
      else showToast(r.error || "Update failed");
    }
  );
}

// ── Submissions ───────────────────────────────────────────────────────────────
let subPage = 1;
const SUB_PAGE_SIZE = 20;
let selectedReviewHospitalId = "";
let selectedReviewHospitalName = "";
let currentHospitalPendingRows = [];
let currentReviewIndex = -1;
let currentReviewDetails = null;

async function loadAdminSubs(page = subPage) {
  subPage = page;
  const search = document.getElementById("admin-sub-search")?.value?.trim() || "";
  const select = document.getElementById("admin-sub-hospital-filter");
  const requestedHospital = select?.value || selectedReviewHospitalId || "";
  selectedReviewHospitalId = requestedHospital;
  selectedReviewHospitalName = adminHospitals.find((item) => item.id === selectedReviewHospitalId)?.name || selectedReviewHospitalName;

  await renderHospitalReviewCards();
  const wrap = document.getElementById("admin-sub-table-wrap");
  if (!wrap) return;

  const pagination = document.getElementById("admin-sub-pagination");
  if (!selectedReviewHospitalId) {
    wrap.innerHTML = `<p class="admin-empty">Select a hospital queue above to start reviewing pending records.</p>`;
    if (pagination) pagination.innerHTML = "";
    return;
  }

  const pendingRows = await fetchAllPendingSubmissions(selectedReviewHospitalId, search);
  currentHospitalPendingRows = pendingRows;

  if (!pendingRows.length) {
    wrap.innerHTML = `<p class="admin-empty">No pending submissions found for ${escapeHTML(selectedReviewHospitalName || selectedReviewHospitalId)}.</p>`;
    if (pagination) pagination.innerHTML = "";
    return;
  }

  const total = pendingRows.length;
  const pageRows = pendingRows.slice((page - 1) * SUB_PAGE_SIZE, page * SUB_PAGE_SIZE);

  wrap.innerHTML = `<table class="admin-table">
    <thead><tr>
      <th>Record ID</th><th>Patient ID</th><th>Hospital</th><th>Study</th><th>CKD</th><th>Package</th><th>Submitted</th><th>Status</th><th>Action</th>
    </tr></thead>
    <tbody>
      ${pageRows.map((s, idx) => `<tr>
        <td>${escapeHTML(s.recordId || s.participantId || "—")}</td>
        <td>${escapeHTML(s.uhid || "—")}</td>
        <td>${escapeHTML(s.hospitalName || s.hospitalId || "—")}</td>
        <td>${escapeHTML((s.studyFlow || "egfr").toUpperCase())}</td>
        <td>${escapeHTML(s.knownCkd || (s.ckdStage === "Normal" ? "No" : "Yes"))}</td>
        <td>${escapeHTML(subUploadMode(s.uploadMode))}</td>
        <td class="admin-nowrap">${fmtDate(s.receivedAt || s.created_at)}</td>
        <td>${s.reviewedAt ? "Reviewed" : "Awaiting Review"}</td>
        <td>
          <button class="admin-btn admin-btn-outline admin-btn-sm"
            type="button"
            data-action="review-submission"
            data-recordid="${escapeHTML(s.recordId || "")}"
            data-index="${(page - 1) * SUB_PAGE_SIZE + idx}"
            data-reviewed="${s.reviewedAt ? "yes" : "no"}">
            ${s.reviewedAt ? "View / Unreview" : "Review"}
          </button>
        </td>
      </tr>`).join("")}
    </tbody>
  </table>`;

  renderPagination("admin-sub-pagination", page, total, SUB_PAGE_SIZE, loadAdminSubs);
}

async function renderHospitalReviewCards() {
  const cardWrap = document.getElementById("admin-sub-hospital-cards");
  if (!cardWrap) return;

  const summary = await apiGet("/api/dashboard-summary");
  const breakdown = summary.ok
    ? (summary.summary?.pathways?.all?.hospitalBreakdown || summary.summary?.hospitalBreakdown || [])
    : [];

  const pendingByHospital = new Map();
  breakdown.forEach((item) => {
    const pending = Math.max(0, Number(item.patients || 0) - Number(item.reviewed || 0));
    pendingByHospital.set(item.hospitalId, pending);
  });

  const sourceHospitals = adminHospitals.length
    ? adminHospitals
    : Array.from(pendingByHospital.keys()).map((id) => ({ id, name: id }));

  if (!sourceHospitals.length) {
    cardWrap.innerHTML = `<p class="admin-empty">No hospitals found.</p>`;
    return;
  }

  cardWrap.innerHTML = sourceHospitals.map((hospital) => {
    const pending = pendingByHospital.get(hospital.id) || 0;
    const isActive = selectedReviewHospitalId === hospital.id;
    return `<button type="button" class="admin-hospital-card ${isActive ? "active" : ""}"
      data-action="select-hospital-queue"
      data-hospitalid="${escapeHTML(hospital.id)}"
      data-hospitalname="${escapeHTML(hospital.name)}">
      <div class="admin-hospital-card-head">
        <p class="admin-hospital-card-name">${escapeHTML(hospital.name)}</p>
        <span class="admin-pending-pill">${pending}</span>
      </div>
      <p class="admin-hospital-card-meta">${pending === 1 ? "1 pending review" : `${pending} pending reviews`}</p>
    </button>`;
  }).join("");
}

async function fetchAllPendingSubmissions(hospitalId, search = "") {
  if (!hospitalId) return [];
  const all = [];
  let page = 1;

  while (page <= 200) {
    const params = new URLSearchParams({
      page: String(page),
      limit: "50",
      hospitalId,
      reviewed: "no"
    });
    if (search) params.set("search", search);
    const res = await apiGet(`/api/submissions?${params}`);
    if (!res.ok) return page === 1 ? [] : all;
    const rows = res.items || res.submissions || [];
    all.push(...rows);
    if (!rows.length || all.length >= Number(res.total || all.length)) break;
    page += 1;
  }

  return all;
}

function handleSubmissionClick(e) {
  const queueBtn = e.target.closest("[data-action='select-hospital-queue']");
  if (queueBtn) {
    const select = document.getElementById("admin-sub-hospital-filter");
    selectedReviewHospitalId = queueBtn.dataset.hospitalid || "";
    selectedReviewHospitalName = queueBtn.dataset.hospitalname || "";
    if (select) select.value = selectedReviewHospitalId;
    subPage = 1;
    loadAdminSubs(1);
    return;
  }

  const btn = e.target.closest("[data-action='review-submission']");
  if (!btn) return;
  const recordId = btn.dataset.recordid;
  const index = Number.parseInt(btn.dataset.index || "-1", 10);
  if (!recordId) {
    showToast("Record ID is missing for this submission.");
    return;
  }
  openSubmissionReviewModal(recordId, index);
}

function yesNoLabel(value) {
  if (value === true || value === "Yes") return "Yes";
  if (value === false || value === "No") return "No";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function buildSubmissionReviewRows(submission) {
  const findings = submission.ultrasoundFindings || {};
  const kfreForm = submission.kfreForm || {};
  const examination = kfreForm.clinicalExamination || {};
  const events = kfreForm.clinicalEvents || {};
  const outcomes = kfreForm.outcomes || {};
  const labs = kfreForm.labs || {};

  const rows = [
    ["Record ID", submission.recordId || "—"],
    ["Study", (submission.studyFlow || "egfr").toUpperCase()],
    ["Hospital", submission.hospitalName || submission.hospitalId || "—"],
    ["Patient UHID", submission.uhid || "—"],
    ["Sex", submission.sex || "—"],
    ["Age", submission.age ?? "—"],
    ["CKD", yesNoLabel(submission.knownCkd)],
    ["CKD Stage", submission.ckdStage || "—"],
    ["Upload Mode", subUploadMode(submission.uploadMode)],
    ["Submitted", fmtDate(submission.receivedAt)],
    ["Reviewed", submission.reviewedAt ? `Yes (${fmtDate(submission.reviewedAt)})` : "No"],
    ["Reviewed By", submission.reviewedBy || "—"]
  ];

  if ((submission.studyFlow || "egfr") === "kfre") {
    const systolic = examination.systolicBp || submission.kfreForm?.bloodPressure || "";
    const diastolic = examination.diastolicBp || "";
    rows.push(["Blood Pressure", systolic && diastolic ? `${systolic}/${diastolic} mmHg` : systolic || "—"]);
    rows.push(["Heart Rate", examination.heartRate ? `${examination.heartRate} bpm` : (submission.kfreForm?.heartRate || "—")]);
    rows.push(["Waist-to-Hip Ratio", examination.waistHipRatio || submission.kfreForm?.waistHipRatio || "—"]);
    rows.push(["Hospitalization", events.hospitalization || "—"]);
    rows.push(["Dialysis Initiated", events.dialysisInitiated || "—"]);
    rows.push(["Transplant", events.transplant || "—"]);
    rows.push(["Rapid Progression", outcomes.rapidProgression || "—"]);
    rows.push(["Kidney Failure Event", outcomes.kidneyFailureEvent || "—"]);
    rows.push(["KFRE eGFR", labs.egfr || "—"]);
    rows.push(["KFRE Urine ACR", labs.acr || "—"]);
    rows.push(["KFRE Urine PCR", labs.pcr || "—"]);
  } else {
    rows.push(["Image Adequate", findings.imageQuality?.adequateForAnalysis || "—"]);
    rows.push(["Bounding Points", findings.annotationDetails?.kidneyBoundingPointsDetected || "—"]);
  }

  const qualityWarnings = Array.isArray(submission.dataQualityWarnings) ? submission.dataQualityWarnings : [];
  rows.push(["Quality Warnings", qualityWarnings.length ? qualityWarnings.join("; ") : "None"]);

  return rows;
}

function buildFileReviewList(submission) {
  const files = Array.isArray(submission.files) ? submission.files : [];
  if (!files.length) return "<p class=\"admin-empty\">No files listed for this record.</p>";
  return `<ul class="admin-review-list">
    ${files.map((file) => {
      if (typeof file === "string") {
        return `<li><strong>file</strong>: ${escapeHTML(file)}</li>`;
      }
      const field = file.fieldName || "file";
      const name = file.originalName || file.fileName || file.storedName || "Unnamed";
      const size = file.sizeLabel || (Number.isFinite(Number(file.size)) ? formatFileSize(Number(file.size)) : "size unknown");
      return `<li><strong>${escapeHTML(field)}</strong>: ${escapeHTML(name)} (${escapeHTML(size)})</li>`;
    }).join("")}
  </ul>`;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1) return "size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function reviewNavigatorHtml() {
  if (currentReviewIndex < 0 || !currentHospitalPendingRows.length) return "";
  return `<div class="admin-review-toolbar">
    <p class="admin-review-index">Record ${currentReviewIndex + 1} of ${currentHospitalPendingRows.length}</p>
    <div class="admin-review-nav">
      <button class="admin-btn admin-btn-outline admin-btn-sm" type="button" data-action="review-prev" ${currentReviewIndex <= 0 ? "disabled" : ""}>← Previous</button>
      <button class="admin-btn admin-btn-outline admin-btn-sm" type="button" data-action="review-next" ${currentReviewIndex >= currentHospitalPendingRows.length - 1 ? "disabled" : ""}>Next →</button>
    </div>
  </div>`;
}

function buildSubmissionReviewModalBody(submission) {
  const rows = buildSubmissionReviewRows(submission);
  return `<div class="admin-review-wrap">
    ${reviewNavigatorHtml()}
    <table class="admin-table">
      <tbody>
        ${rows.map(([label, value]) => `<tr><th>${escapeHTML(label)}</th><td>${escapeHTML(String(value))}</td></tr>`).join("")}
      </tbody>
    </table>
    <h4>Uploaded Files</h4>
    ${buildFileReviewList(submission)}
  </div>`;
}

async function openSubmissionReviewModal(recordId, index = -1) {
  currentReviewIndex = Number.isInteger(index) ? index : -1;
  if (currentReviewIndex < 0 && currentHospitalPendingRows.length) {
    currentReviewIndex = currentHospitalPendingRows.findIndex((item) => item.recordId === recordId);
  }
  const result = await apiGet(`/api/submissions/${encodeURIComponent(recordId)}`);
  if (!result.ok || !result.submission) {
    showToast(result.error || "Could not load submission details.");
    return;
  }
  const submission = result.submission;
  currentReviewDetails = submission;
  const isReviewed = Boolean(submission.reviewedAt);
  const confirmText = isReviewed ? "Mark Pending" : "Mark Reviewed";

  openModal(
    `${isReviewed ? "Review Completed" : "Submission Review"} — ${submission.recordId || recordId}`,
    buildSubmissionReviewModalBody(submission),
    async () => {
      const response = await apiReq(`/api/submissions/${encodeURIComponent(recordId)}`, { reviewed: !isReviewed }, "PATCH");
      if (!response.ok) {
        showToast(response.error || "Could not update review status.");
        return;
      }
      if (!isReviewed && currentReviewIndex >= 0) {
        currentHospitalPendingRows.splice(currentReviewIndex, 1);
      } else if (isReviewed) {
        await loadAdminSubs(subPage);
      }
      showToast(!isReviewed ? "Submission marked as reviewed." : "Submission moved back to pending.");
      await renderHospitalReviewCards();

      if (!isReviewed && currentHospitalPendingRows.length) {
        const nextIndex = Math.min(currentReviewIndex, currentHospitalPendingRows.length - 1);
        const nextRecord = currentHospitalPendingRows[nextIndex];
        await openSubmissionReviewModal(nextRecord.recordId, nextIndex);
      } else {
        closeModal();
      }

      loadAdminSubs(subPage);
      if (activeSection === "overview") loadOverview();
    },
    { confirmText, cancelText: "Close" }
  );

  const modalBody = document.getElementById("admin-modal-body");
  modalBody?.querySelector("[data-action='review-prev']")?.addEventListener("click", async () => {
    if (currentReviewIndex <= 0) return;
    const prev = currentHospitalPendingRows[currentReviewIndex - 1];
    if (prev?.recordId) await openSubmissionReviewModal(prev.recordId, currentReviewIndex - 1);
  });
  modalBody?.querySelector("[data-action='review-next']")?.addEventListener("click", async () => {
    if (currentReviewIndex >= currentHospitalPendingRows.length - 1) return;
    const next = currentHospitalPendingRows[currentReviewIndex + 1];
    if (next?.recordId) await openSubmissionReviewModal(next.recordId, currentReviewIndex + 1);
  });
}

async function doExportCsv() {
  const res = await authedFetch("/api/submissions/export");
  if (!res.ok) { showToast("Export failed"); return; }
  const text = await res.text();
  const blob = new Blob([text], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `tanuh-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Audit Log ─────────────────────────────────────────────────────────────────
let auditPage = 1;
const AUDIT_PAGE_SIZE = 50;

async function loadAudit(page = auditPage) {
  auditPage = page;
  const hospitalId = document.getElementById("audit-hospital-filter")?.value || "";
  const eventType  = document.getElementById("audit-event-filter")?.value   || "";
  const from       = document.getElementById("audit-from")?.value           || "";
  const to         = document.getElementById("audit-to")?.value             || "";
  const params     = new URLSearchParams({ page, limit: AUDIT_PAGE_SIZE });
  if (hospitalId) params.set("hospitalId", hospitalId);
  if (eventType)  params.set("eventType",  eventType);
  if (from)       params.set("from", from);
  if (to)         params.set("to",   to);

  const res  = await apiGet(`/api/admin/audit?${params}`);
  const wrap = document.getElementById("audit-table-wrap");
  if (!wrap) return;

  if (!res.ok || !res.logs?.length) {
    wrap.innerHTML = `<p class="admin-empty">No log entries found.</p>`;
    document.getElementById("audit-pagination").innerHTML = "";
    return;
  }
  wrap.innerHTML = buildAuditTable(res.logs, true);
  renderPagination("audit-pagination", page, res.total, AUDIT_PAGE_SIZE, loadAudit);
}

function buildAuditTable(logs, showHospital = false) {
  return `<table class="admin-table">
    <thead><tr>
      <th>Time</th><th>Event</th>${showHospital ? "<th>Hospital</th>" : ""}<th>IP</th>
    </tr></thead>
    <tbody>
      ${logs.map((l) => `<tr>
        <td class="admin-nowrap">${fmtDate(l.created_at || l.timestamp)}</td>
        <td><code>${escapeHTML(l.event_type)}</code></td>
        ${showHospital ? `<td>${escapeHTML(l.hospital_name || l.hospital_id || "—")}</td>` : ""}
        <td>${escapeHTML(l.ip_address || l.ip || "—")}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

// ── Analytics ─────────────────────────────────────────────────────────────────
async function loadAnalytics() {
  const days = document.getElementById("trend-days")?.value || 30;
  let [trends, dist] = await Promise.all([
    apiGet(`/api/admin/analytics/trends?days=${days}`),
    apiGet("/api/admin/analytics/distribution"),
  ]);
  if (!dist.ok) {
    const fallback = await apiGet("/api/dashboard-summary");
    if (fallback.ok && fallback.summary) {
      dist = {
        ok: true,
        ckd_stages: (fallback.summary.stages || []).map((item) => ({ stage: item.label, count: item.value })),
        by_hospital: (fallback.summary.hospitalBreakdown || []).map((item) => ({
          hospital_id: item.hospitalId,
          hospital_name: item.hospitalName,
          count: item.patients
        }))
      };
    }
  }

  const trendWrap = document.getElementById("analytics-trend-wrap");
  if (trendWrap) {
    if (trends.ok && trends.trends?.length) {
      const items   = trends.trends.slice(-14);
      const maxVal  = Math.max(...items.map((t) => t.count), 1);
      trendWrap.innerHTML = `<div class="analytics-bar-chart">
        ${items.map((t) => `<div class="analytics-bar-row">
          <span class="analytics-bar-label">${escapeHTML(t.date?.slice(5) || "")}</span>
          <div class="analytics-bar-track">
            <div class="analytics-bar-fill" data-pct="${Math.round((t.count / maxVal) * 100)}"></div>
          </div>
          <span class="analytics-bar-count">${t.count}</span>
        </div>`).join("")}
      </div>`;
      applyBarWidths(trendWrap);
    } else {
      trendWrap.innerHTML = `<p class="admin-empty">No trend data available.</p>`;
    }
  }

  if (dist.ok) {
    const ckdWrap = document.getElementById("analytics-ckd-wrap");
    if (ckdWrap && dist.ckd_stages?.length) {
      const maxVal = Math.max(...dist.ckd_stages.map((s) => s.count), 1);
      ckdWrap.innerHTML = `<div class="analytics-bar-chart">
        ${dist.ckd_stages.map((s) => `<div class="analytics-bar-row">
          <span class="analytics-bar-label">${escapeHTML(s.stage === "Yes" ? "CKD: Yes" : s.stage === "No" ? "CKD: No" : String(s.stage ?? "Unknown"))}</span>
          <div class="analytics-bar-track">
            <div class="analytics-bar-fill analytics-bar-teal" data-pct="${Math.round((s.count / maxVal) * 100)}"></div>
          </div>
          <span class="analytics-bar-count">${s.count}</span>
        </div>`).join("")}
      </div>`;
      applyBarWidths(ckdWrap);
    } else if (ckdWrap) {
      ckdWrap.innerHTML = `<p class="admin-empty">No distribution data.</p>`;
    }

    const hospWrap = document.getElementById("analytics-hosp-wrap");
    if (hospWrap && dist.by_hospital?.length) {
      const maxVal = Math.max(...dist.by_hospital.map((h) => h.count), 1);
      hospWrap.innerHTML = `<div class="analytics-bar-chart">
        ${dist.by_hospital.map((h) => `<div class="analytics-bar-row">
          <span class="analytics-bar-label">${escapeHTML(h.hospital_name || h.hospital_id)}</span>
          <div class="analytics-bar-track">
            <div class="analytics-bar-fill analytics-bar-dark" data-pct="${Math.round((h.count / maxVal) * 100)}"></div>
          </div>
          <span class="analytics-bar-count">${h.count}</span>
        </div>`).join("")}
      </div>`;
      applyBarWidths(hospWrap);
    } else if (hospWrap) {
      hospWrap.innerHTML = `<p class="admin-empty">No hospital data.</p>`;
    }
  }
}

// ── System Health ─────────────────────────────────────────────────────────────
async function loadSystem() {
  const [sysRes, sessRes] = await Promise.all([
    apiGet("/api/admin/system"),
    apiGet("/api/admin/sessions"),
  ]);

  const statsWrap = document.getElementById("admin-system-stats");
  if (statsWrap && sysRes.ok) {
    const cards = [
      { label: "Uptime",          value: fmtUptime(sysRes.uptime_seconds) },
      { label: "Node.js",         value: sysRes.node_version  },
      { label: "Memory (RSS)",    value: `${sysRes.memory_rss_mb} MB` },
      { label: "Database",        value: sysRes.db_ready       ? "✓ Connected"      : `✗ Disconnected${sysRes.db_reason ? " — check DB Note in Overview" : ""}`  },
      { label: "GCS Storage",     value: sysRes.gcs_configured ? "✓ Configured"     : "✗ Not configured" },
      { label: "Active Sessions", value: sysRes.active_sessions },
    ];
    statsWrap.innerHTML = cards.map((c) => `<div class="admin-stat-card">
      <div class="admin-stat-label">${escapeHTML(c.label)}</div>
      <div class="admin-stat-value admin-stat-value-lg">${escapeHTML(String(c.value ?? "—"))}</div>
    </div>`).join("");
  }

  const wrap = document.getElementById("sessions-table-wrap");
  if (!wrap) return;

  if (!sessRes.ok || !sessRes.sessions?.length) {
    wrap.innerHTML = `<p class="admin-empty">No active sessions.</p>`;
    return;
  }

  wrap.innerHTML = `<table class="admin-table">
    <thead><tr><th>User ID</th><th>Hospital</th><th>Role</th><th>Expires</th><th>Action</th></tr></thead>
    <tbody>
      ${sessRes.sessions.map((s) => `<tr>
        <td>${escapeHTML(s.userId)}</td>
        <td>${escapeHTML(s.hospitalId || "—")}</td>
        <td>${escapeHTML(s.role)}</td>
        <td class="admin-nowrap">${fmtDate(s.expiresAt)}</td>
        <td><button class="admin-btn admin-btn-danger admin-btn-sm"
          data-action="force-logout" data-userid="${escapeHTML(s.userId)}" type="button">Force Logout</button></td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function handleSessionClick(e) {
  const btn = e.target.closest("[data-action='force-logout']");
  if (!btn) return;
  forceLogout(btn.dataset.userid);
}

async function forceLogout(userId) {
  const res  = await authedFetch(`/api/admin/sessions/${encodeURIComponent(userId)}`, { method: "DELETE" });
  const data = await res.json();
  if (data.ok) { showToast(`Logged out ${data.removed ?? ""}  session(s) for ${userId}`, 3500); loadSystem(); }
  else showToast(data.error || "Force logout failed");
}

// ── Pagination ────────────────────────────────────────────────────────────────
function renderPagination(containerId, page, total, pageSize, loadFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const totalPages = Math.ceil((total || 0) / pageSize);
  if (totalPages <= 1) { el.innerHTML = ""; return; }

  el.innerHTML = `
    <button class="admin-btn admin-btn-outline admin-btn-sm" id="${containerId}-prev"
      ${page <= 1 ? "disabled" : ""} type="button">← Prev</button>
    <span>Page ${page} of ${totalPages} (${total} records)</span>
    <button class="admin-btn admin-btn-outline admin-btn-sm" id="${containerId}-next"
      ${page >= totalPages ? "disabled" : ""} type="button">Next →</button>
  `;

  el.querySelector(`#${containerId}-prev`)?.addEventListener("click", () => loadFn(page - 1));
  el.querySelector(`#${containerId}-next`)?.addEventListener("click", () => loadFn(page + 1));
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(title, bodyHTML, onConfirm, options = {}) {
  const overlay = document.getElementById("admin-modal-overlay");
  const titleEl = document.getElementById("admin-modal-title");
  const bodyEl  = document.getElementById("admin-modal-body");
  const confirmBtn = document.getElementById("admin-modal-confirm");
  const cancelBtn = document.getElementById("admin-modal-cancel");
  if (!overlay) return;
  if (titleEl) titleEl.textContent = title;
  if (bodyEl)  bodyEl.innerHTML = bodyHTML;
  if (confirmBtn) {
    confirmBtn.textContent = options.confirmText || "Confirm";
    confirmBtn.classList.toggle("hidden", options.hideConfirm === true);
  }
  if (cancelBtn) {
    cancelBtn.textContent = options.cancelText || "Cancel";
  }
  overlay.classList.remove("hidden");
  modalConfirmFn = onConfirm;
  setTimeout(() => bodyEl?.querySelector("input")?.focus(), 50);
}

export function closeModal() {
  const confirmBtn = document.getElementById("admin-modal-confirm");
  const cancelBtn = document.getElementById("admin-modal-cancel");
  if (confirmBtn) {
    confirmBtn.textContent = "Confirm";
    confirmBtn.classList.remove("hidden");
  }
  if (cancelBtn) cancelBtn.textContent = "Cancel";
  document.getElementById("admin-modal-overlay")?.classList.add("hidden");
  modalConfirmFn = null;
}
