import { state } from "./state.js";
import { authedFetch, handle401, hospitals } from "./api.js";
import { escapeHTML, formatCkdStage, getCkdStageClass, showToast } from "./utils.js";

const ADMIN_INTAKE_SOURCE = { id: "TANUH-ADMIN", name: "Admin" };
const EXPORT_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

export const subState = { page: 1, total: 0, limit: 20 };

let reviewRenderers = {
  getKidneyFindingReviewRows: () => [],
  getUltrasoundQualityReviewRows: () => [],
  getKfreReviewRows: () => []
};

export function configureSubmissionRenderers(renderers) {
  reviewRenderers = { ...reviewRenderers, ...renderers };
}

function getSelectableIntakeSources() {
  return state.authSession?.role === "admin"
    ? [...hospitals, ADMIN_INTAKE_SOURCE]
    : hospitals;
}

function subFormatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function subBadge(reviewed) {
  return reviewed
    ? `<span class="sub-badge sub-badge-reviewed">Reviewed</span>`
    : `<span class="sub-badge sub-badge-pending">Awaiting Review</span>`;
}

export function subUploadMode(mode) {
  if (mode === "clinical_document") return "Clinical Document";
  return mode === "package" ? "ZIP Package" : "Separate Files";
}

export async function loadSubmissions(page = 1) {
  const subTbody = document.getElementById("sub-tbody");
  const subHospitalFilter = document.getElementById("sub-hospital-filter");
  const subReviewedFilter = document.getElementById("sub-reviewed-filter");
  const subSearchInput = document.getElementById("sub-search-input");
  const subDateFromInput = document.getElementById("sub-date-from");
  const subDateToInput = document.getElementById("sub-date-to");
  if (!subTbody) return;
  subTbody.innerHTML = '<tr><td colspan="9" class="empty">Loading…</td></tr>';

  const params = new URLSearchParams({ page, limit: subState.limit });
  const hospital = subHospitalFilter?.value || "";
  const reviewed = subReviewedFilter?.value || "";
  const search = subSearchInput?.value.trim() || "";
  const dateFrom = subDateFromInput?.value || "";
  const dateTo = subDateToInput?.value || "";
  if (hospital) params.set("hospitalId", hospital);
  if (reviewed) params.set("reviewed", reviewed);
  if (search) params.set("search", search);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);

  try {
    const res = await authedFetch(`/api/submissions?${params}`);
    if (res.status === 401) { handle401(); return; }
    const result = await res.json();
    if (!res.ok || !result.ok) {
      subTbody.innerHTML = `<tr><td colspan="9" class="empty">${escapeHTML(result.error || "Failed to load.")}</td></tr>`;
      return;
    }

    subState.page = result.page;
    subState.total = result.total;
    renderSubmissionsTable(result.items);
    updateSubPagination();
  } catch {
    subTbody.innerHTML = '<tr><td colspan="9" class="empty">Network error. Please try again.</td></tr>';
  }
}

export function renderSubmissionsTable(items) {
  const subTbody = document.getElementById("sub-tbody");
  if (!subTbody) return;
  if (!items.length) {
    subTbody.innerHTML = '<tr><td colspan="9" class="empty">No submissions match the current filters.</td></tr>';
    return;
  }

  const start = (subState.page - 1) * subState.limit;
  subTbody.innerHTML = "";
  items.forEach((item, index) => {
    const row = document.createElement("tr");
    row.className = "sub-row";
    row.dataset.recordId = item.recordId;
    row.innerHTML = `
      <td class="sub-num">${start + index + 1}</td>
      <td class="sub-uhid">${escapeHTML(item.uhid)}</td>
      <td class="sub-hospital" title="${escapeHTML(item.hospitalName || "")}">${escapeHTML(item.hospitalId)}</td>
      <td>${escapeHTML(item.age || "—")} / ${escapeHTML(item.sex || "—")}</td>
      <td><span class="sub-stage-badge stage-${getCkdStageClass(item.ckdStage)}">${escapeHTML(formatCkdStage(item.ckdStage))}</span></td>
      <td>${escapeHTML(item.studyFlow === "kfre" ? "KFRE · Clinical Document" : subUploadMode(item.uploadMode))}</td>
      <td>${item.fileCount}</td>
      <td class="sub-date">${subFormatDate(item.receivedAt)}</td>
      <td>${subBadge(item.reviewedAt)}</td>
    `;
    row.addEventListener("click", () => openSubmissionDetail(item.recordId));
    subTbody.appendChild(row);
  });
}

function updateSubPagination() {
  const subPageInfo = document.getElementById("sub-page-info");
  const subPrevBtn = document.getElementById("sub-prev-btn");
  const subNextBtn = document.getElementById("sub-next-btn");
  const totalPages = Math.max(1, Math.ceil(subState.total / subState.limit));
  if (subPageInfo) subPageInfo.textContent = `Page ${subState.page} of ${totalPages} (${subState.total} record${subState.total !== 1 ? "s" : ""})`;
  if (subPrevBtn) subPrevBtn.disabled = subState.page <= 1;
  if (subNextBtn) subNextBtn.disabled = subState.page >= totalPages;
}

export async function openSubmissionDetail(recordId) {
  const subDetailOverlay = document.getElementById("sub-detail-overlay");
  const subDetailTitle = document.getElementById("sub-detail-title");
  const subDetailSubtitle = document.getElementById("sub-detail-subtitle");
  const subDetailBody = document.getElementById("sub-detail-body");
  const subDetailFooter = document.getElementById("sub-detail-footer");
  if (!subDetailOverlay) return;
  subDetailOverlay.classList.remove("hidden");
  if (subDetailTitle) subDetailTitle.textContent = "Loading…";
  if (subDetailSubtitle) subDetailSubtitle.textContent = "";
  if (subDetailBody) subDetailBody.innerHTML = '<p class="sub-detail-loading">Fetching record…</p>';
  if (subDetailFooter) subDetailFooter.innerHTML = "";

  try {
    const res = await authedFetch(`/api/submissions/${encodeURIComponent(recordId)}`);
    if (res.status === 401) { handle401(); return; }
    const result = await res.json();
    if (!res.ok || !result.ok) {
      if (subDetailBody) subDetailBody.innerHTML = `<p class="sub-detail-error">${escapeHTML(result.error || "Failed to load.")}</p>`;
      return;
    }
    renderSubmissionDetail(result.submission);
  } catch {
    if (subDetailBody) subDetailBody.innerHTML = '<p class="sub-detail-error">Network error.</p>';
  }
}

export function renderSubmissionDetail(submission) {
  const subDetailTitle = document.getElementById("sub-detail-title");
  const subDetailSubtitle = document.getElementById("sub-detail-subtitle");
  const subDetailBody = document.getElementById("sub-detail-body");
  const subDetailFooter = document.getElementById("sub-detail-footer");
  if (subDetailTitle) subDetailTitle.textContent = escapeHTML(submission.uhid);
  if (subDetailSubtitle) subDetailSubtitle.textContent = `${submission.hospitalName || submission.hospitalId}  ·  ${subFormatDate(submission.receivedAt)}`;

  const field = (label, value) => value && value !== "-"
    ? `<div class="sub-detail-field"><span class="sub-detail-key">${label}</span><span class="sub-detail-val">${escapeHTML(String(value))}</span></div>`
    : "";

  const fileList = (submission.files || []).map((file) =>
    `<li class="sub-file-item"><span class="sub-file-name">${escapeHTML(file.originalName || file.storedName)}</span><span class="sub-file-size">${(file.size / 1024).toFixed(0)} KB</span></li>`
  ).join("");
  const qualityWarnings = Array.isArray(submission.dataQualityWarnings) ? submission.dataQualityWarnings : [];
  const ultrasoundFindingRows = [
    ...reviewRenderers.getKidneyFindingReviewRows("Right Kidney", submission.ultrasoundFindings?.right),
    ...reviewRenderers.getKidneyFindingReviewRows("Left Kidney", submission.ultrasoundFindings?.left),
    ...reviewRenderers.getUltrasoundQualityReviewRows(submission.ultrasoundFindings)
  ].filter(([, value]) => value !== "-");
  const ultrasoundFindingSection = ultrasoundFindingRows.length ? `
    <section class="sub-detail-section">
      <h3 class="sub-detail-section-title">Ultrasound Findings</h3>
      ${ultrasoundFindingRows.map(([label, value]) => field(label, value)).join("")}
    </section>
  ` : "";
  const kfreRows = reviewRenderers.getKfreReviewRows(submission.kfreForm);
  const kfreSection = submission.studyFlow === "kfre" && kfreRows.length ? `
    <section class="sub-detail-section">
      <h3 class="sub-detail-section-title">KFRE Clinical and Outcome Data</h3>
      ${kfreRows.map(([label, value]) => field(label, value)).join("")}
    </section>
  ` : "";
  const qualitySection = qualityWarnings.length ? `
    <section class="sub-detail-section sub-quality-section">
      <h3 class="sub-detail-section-title">Data Quality Checks</h3>
      <ul class="sub-warning-list">
        ${qualityWarnings.map((warning) => `<li>${escapeHTML(warning)}</li>`).join("")}
      </ul>
    </section>
  ` : "";

  if (subDetailBody) subDetailBody.innerHTML = `
    <section class="sub-detail-section">
      <h3 class="sub-detail-section-title">Patient</h3>
      ${field("Record ID", submission.recordId)}
      ${field("Participant ID", submission.participantId)}
      ${field("Patient ID", submission.uhid)}
      ${field("Age", submission.age)}
      ${field("Sex", submission.sex)}
      ${field("Height (cm)", submission.heightCm)}
      ${field("Weight (kg)", submission.weight)}
      ${field("BMI", submission.bmi)}
      ${field("Ethnicity", submission.ethnicity)}
      ${field("Occupation", submission.occupation)}
    </section>
    <section class="sub-detail-section">
      <h3 class="sub-detail-section-title">Clinical</h3>
      ${field("Kidney Status", formatCkdStage(submission.ckdStage, submission.ckdStageRemarks))}
      ${field("Known CKD", submission.knownCkd)}
      ${field("CKD Duration", submission.ckdDuration)}
      ${field("Dialysis", submission.dialysis)}
      ${field("Dialysis Frequency", submission.dialysisFrequency)}
      ${field("Diabetic", submission.diabetic)}
      ${field("Diabetic Stage", submission.diabeticStage)}
      ${field("Diabetes Duration", submission.diabetesDuration)}
      ${field("Hypertension", submission.hypertension)}
      ${field("Hypert. Duration", submission.hypertensionDuration)}
      ${field("Cardiovascular Dis.", submission.cardiovascularDisease)}
      ${field("Family Kidney Hist.", submission.familyKidneyHistory)}
    </section>
    ${ultrasoundFindingSection}
    ${kfreSection}
    <section class="sub-detail-section">
      <h3 class="sub-detail-section-title">Submission</h3>
      ${field("Hospital", submission.hospitalName || submission.hospitalId)}
      ${field("Study Pathway", submission.studyFlow === "kfre" ? "KFRE Study" : "eGFR Study")}
      ${field("Upload Mode", subUploadMode(submission.uploadMode))}
      ${field("Enrollment Date", submission.enrollmentDate)}
      ${field("Consent ID", submission.consentId)}
      ${field("Batch ID", submission.batchId)}
      ${field("Received At", subFormatDate(submission.receivedAt))}
    </section>
    ${qualitySection}
    ${fileList ? `<section class="sub-detail-section"><h3 class="sub-detail-section-title">Files</h3><ul class="sub-file-list">${fileList}</ul></section>` : ""}
    ${submission.reviewedAt ? `<section class="sub-detail-section"><h3 class="sub-detail-section-title">Review</h3>${field("Reviewed At", subFormatDate(submission.reviewedAt))}${field("Reviewed By", submission.reviewedBy)}</section>` : ""}
  `;

  if (subDetailFooter && state.authSession?.role === "admin") {
    const isReviewed = Boolean(submission.reviewedAt);
    const button = document.createElement("button");
    button.type = "button";
    button.className = isReviewed ? "btn-ghost sub-review-btn" : "btn-primary sub-review-btn";
    button.textContent = isReviewed ? "Clear Review" : "Mark as Reviewed";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Saving…";
      try {
        const res = await authedFetch(`/api/submissions/${encodeURIComponent(submission.recordId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewed: !isReviewed })
        });
        const result = await res.json();
        if (res.ok && result.ok) {
          openSubmissionDetail(submission.recordId);
          loadSubmissions(subState.page);
        } else {
          button.disabled = false;
          button.textContent = isReviewed ? "Clear Review" : "Mark as Reviewed";
        }
      } catch {
        button.disabled = false;
        button.textContent = isReviewed ? "Clear Review" : "Mark as Reviewed";
      }
    });
    subDetailFooter.innerHTML = "";
    subDetailFooter.appendChild(button);
  }
}

export function closeSubmissionDetail() {
  document.getElementById("sub-detail-overlay")?.classList.add("hidden");
}

export function populateSubHospitalFilter() {
  const subHospitalFilter = document.getElementById("sub-hospital-filter");
  if (!subHospitalFilter) return;
  const isAdmin = state.authSession?.role === "admin";
  const wrap = document.getElementById("sub-hospital-filter-wrap");
  wrap?.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) return;
  while (subHospitalFilter.options.length > 1) subHospitalFilter.remove(1);
  getSelectableIntakeSources().forEach((hospital) => {
    const option = document.createElement("option");
    option.value = hospital.id;
    option.textContent = hospital.name;
    subHospitalFilter.appendChild(option);
  });
}

export async function exportSubmissionsCsv() {
  const subExportBtn = document.getElementById("sub-export-csv");
  const subHospitalFilter = document.getElementById("sub-hospital-filter");
  const subReviewedFilter = document.getElementById("sub-reviewed-filter");
  const subSearchInput = document.getElementById("sub-search-input");
  const subDateFromInput = document.getElementById("sub-date-from");
  const subDateToInput = document.getElementById("sub-date-to");
  if (!subExportBtn) return;
  subExportBtn.disabled = true;
  subExportBtn.textContent = "Exporting…";

  try {
    const params = new URLSearchParams();
    const hospital = subHospitalFilter?.value || "";
    const reviewed = subReviewedFilter?.value || "";
    const search = subSearchInput?.value.trim() || "";
    const dateFrom = subDateFromInput?.value || "";
    const dateTo = subDateToInput?.value || "";
    if (hospital) params.set("hospitalId", hospital);
    if (reviewed) params.set("reviewed", reviewed);
    if (search) params.set("search", search);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    const res = await authedFetch(`/api/submissions/export?${params}`);
    if (res.status === 401) { handle401(); return; }
    if (!res.ok) {
      showToast("Export failed. Please try again.");
      return;
    }

    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const anchor = document.createElement("a");
    anchor.href = objUrl;
    anchor.download = `tanuh-submissions-${dateStr}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(objUrl);
    showToast("CSV downloaded successfully.");
  } catch {
    showToast("Export failed. Please try again.");
  } finally {
    subExportBtn.disabled = false;
    subExportBtn.innerHTML = `${EXPORT_ICON_SVG} Export CSV`;
  }
}
