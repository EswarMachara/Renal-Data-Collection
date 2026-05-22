const state = {
  pendingSubmission: null,
  recentUploads: [],
  uploadProgress: 0
};

const hospitals = [
  {
    id: "SCMC-RMN-KA",
    name: "Sri Chamundeshwari Medical College, Ramanagara Dist, Karnataka"
  },
  {
    id: "SH-SLM-TN",
    name: "Shanmuga Hospital, Salem, Tamil Nadu"
  },
  {
    id: "JSS-MYS-KA",
    name: "JSS Medical College, Mysore, Karnataka"
  },
  {
    id: "NH-BLR-KA",
    name: "Nira Health Care Private Limited, Bangalore, Karnataka"
  },
  {
    id: "MIL-NDL-DL",
    name: "Mahajan Imaging & Labs, New Delhi"
  }
];

const tabs = document.querySelectorAll(".nav-link[data-tab]");
const panels = {
  egfr: document.getElementById("tab-egfr"),
  dashboard: document.getElementById("tab-dashboard")
};

const egfrForm = document.getElementById("egfr-form");
const recentBody = document.getElementById("recent-body");

const hospitalNameInput = document.getElementById("hospital-name");
const hospitalIdInput = document.getElementById("hospital-id");
const uhidInput = document.getElementById("uhid");
const ageInput = document.getElementById("patient-age");
const sexInput = document.getElementById("patient-sex");
const weightInput = document.getElementById("patient-weight");
const ckdStageInput = document.getElementById("ckd-stage");
const dialysisBlock = document.getElementById("dialysis-block");
const dialysisInput = document.getElementById("dialysis-yes-no");
const dialysisFrequencyInput = document.getElementById("dialysis-frequency");
const diabeticInput = document.getElementById("diabetic-yes-no");
const diabeticStageBlock = document.getElementById("diabetic-stage-block");
const diabeticStageInput = document.getElementById("diabetic-stage");
const uploadModeInputs = document.querySelectorAll("input[name='uploadMode']");
const uploadModeCards = document.querySelectorAll("[data-upload-mode-card]");
const separateUploadSection = document.getElementById("separate-upload-section");
const packageUploadSection = document.getElementById("package-upload-section");
const leftKidneyFileInput = document.getElementById("left-kidney-file");
const rightKidneyFileInput = document.getElementById("right-kidney-file");
const egfrReportInput = document.getElementById("egfr-report");
const patientPackageFileInput = document.getElementById("patient-package-file");
const ultrasoundVideoFileInput = document.getElementById("ultrasound-video-file");
const toast = document.getElementById("toast");

const uploadProgressPanel = document.getElementById("upload-progress-panel");
const uploadProgressFill = document.getElementById("upload-progress-fill");
const uploadProgressPercent = document.getElementById("upload-progress-percent");
const uploadProgressLabel = document.getElementById("upload-progress-label");
const dashboardUpdatedAt = document.getElementById("dashboard-updated-at");
const summaryVideosEl = document.getElementById("summary-videos");
const reviewModal = document.getElementById("review-modal");
const reviewContent = document.getElementById("review-content");
const reviewCloseBtn = document.getElementById("review-close");
const reviewEditBtn = document.getElementById("review-edit");
const reviewProceedBtn = document.getElementById("review-proceed");

const USE_DUMMY_DASHBOARD = false;
const dummyDashboard = {
  summary: { patients: 101, hospitals: 5, findings: 10 },
  stages: { "1": 32, "2": 28, "3": 25, "4": 16 },
  diabetic: { yes: 38, no: 62 },
  stage34: { yes: 41, no: 59 },
  dialysis: { yes: 22, no: 78 },
  monthly: [
    { label: "2026-01", value: 8 },
    { label: "2026-02", value: 15 },
    { label: "2026-03", value: 12 },
    { label: "2026-04", value: 18 },
    { label: "2026-05", value: 10 }
  ],
  ageBuckets: [
    { label: "10-19", value: 6 },
    { label: "20-29", value: 4 },
    { label: "30-39", value: 9 },
    { label: "40-49", value: 7 },
    { label: "50-59", value: 5 },
    { label: "60-69", value: 13 },
    { label: "70-79", value: 7 },
    { label: "80-89", value: 6 }
  ],
  hospitals: [
    { name: "TANUH Central", value: 54 },
    { name: "City Care", value: 27 },
    { name: "Green Valley", value: 19 }
  ]
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2400);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function populateHospitals() {
  hospitals.forEach((hospital) => {
    const option = document.createElement("option");
    option.value = hospital.id;
    option.textContent = hospital.name;
    option.dataset.name = hospital.name;
    hospitalNameInput.appendChild(option);
  });
}

function updateHospitalId() {
  hospitalIdInput.value = hospitalNameInput.value || "";
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getUploadLabel(fieldName) {
  const labels = {
    leftKidney: "Left Kidney",
    rightKidney: "Right Kidney",
    egfrReport: "Clinical Report",
    patientPackage: "ZIP Package",
    ultrasoundVideo: "Ultrasound Video"
  };

  return labels[fieldName] || "Upload";
}

function ensurePreview(input) {
  const tile = input.closest(".upload-tile");
  let preview = tile.querySelector(".file-preview");
  if (!preview) {
    preview = document.createElement("div");
    preview.className = "file-preview";
    tile.appendChild(preview);
  }
  return preview;
}

function renderFilePreview(input, fieldName) {
  const preview = ensurePreview(input);
  const file = input.files[0];
  preview.innerHTML = "";
  preview.classList.remove("has-file");

  if (!file) {
    preview.textContent = "No file selected";
    return;
  }

  preview.classList.add("has-file");
  const details = document.createElement("div");
  details.className = "file-preview-details";
  details.innerHTML = `
    <strong>${escapeHTML(getUploadLabel(fieldName))}</strong>
    <span>${escapeHTML(file.name)}</span>
    <small>${escapeHTML(file.type || "Unknown file type")} • ${formatBytes(file.size)}</small>
  `;

  if (file.type.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = URL.createObjectURL(file);
    image.alt = `${getUploadLabel(fieldName)} preview`;
    image.addEventListener("load", () => URL.revokeObjectURL(image.src), { once: true });
    preview.appendChild(image);
  } else if (file.type.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = URL.createObjectURL(file);
    video.controls = true;
    video.muted = true;
    video.preload = "metadata";
    preview.appendChild(video);
  }

  preview.appendChild(details);
}

function clearFilePreviews() {
  document.querySelectorAll(".file-preview").forEach((preview) => {
    preview.classList.remove("has-file");
    preview.innerHTML = "No file selected";
  });
}

function initializeFilePreviews() {
  [
    [leftKidneyFileInput, "leftKidney"],
    [rightKidneyFileInput, "rightKidney"],
    [egfrReportInput, "egfrReport"],
    [patientPackageFileInput, "patientPackage"],
    [ultrasoundVideoFileInput, "ultrasoundVideo"]
  ].forEach(([input, fieldName]) => {
    renderFilePreview(input, fieldName);
    input.addEventListener("change", () => renderFilePreview(input, fieldName));
  });
}

function activateTab(tabKey) {
  tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabKey;
    tab.classList.toggle("active", isActive);
  });

  Object.entries(panels).forEach(([key, panel]) => {
    panel.classList.toggle("visible", key === tabKey);
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

hospitalNameInput.addEventListener("change", updateHospitalId);

function getUploadMode() {
  return document.querySelector("input[name='uploadMode']:checked")?.value || "separate";
}

function updateUploadModeVisibility() {
  const mode = getUploadMode();
  separateUploadSection.classList.toggle("hidden", mode !== "separate");
  packageUploadSection.classList.toggle("hidden", mode !== "package");

  leftKidneyFileInput.required = mode === "separate";
  rightKidneyFileInput.required = mode === "separate";
  egfrReportInput.required = mode === "separate";
  patientPackageFileInput.required = mode === "package";

  if (mode === "separate") {
    patientPackageFileInput.value = "";
    renderFilePreview(patientPackageFileInput, "patientPackage");
  } else {
    leftKidneyFileInput.value = "";
    rightKidneyFileInput.value = "";
    egfrReportInput.value = "";
    renderFilePreview(leftKidneyFileInput, "leftKidney");
    renderFilePreview(rightKidneyFileInput, "rightKidney");
    renderFilePreview(egfrReportInput, "egfrReport");
  }

  uploadModeCards.forEach((card) => {
    card.classList.toggle("selected", card.dataset.uploadModeCard === mode);
  });
}

uploadModeInputs.forEach((input) => {
  input.addEventListener("change", updateUploadModeVisibility);
});

function updateDialysisVisibility() {
  const stage = ckdStageInput.value;
  const shouldShow = stage === "3" || stage === "4";
  dialysisBlock.classList.toggle("hidden", !shouldShow);

  if (!shouldShow) {
    dialysisInput.value = "";
    dialysisFrequencyInput.value = "";
  }
}

function updateDiabeticVisibility() {
  const isDiabetic = diabeticInput.value === "Yes";
  diabeticStageBlock.classList.toggle("hidden", !isDiabetic);
  if (!isDiabetic) {
    diabeticStageInput.value = "";
  }
}

ckdStageInput.addEventListener("change", updateDialysisVisibility);
diabeticInput.addEventListener("change", updateDiabeticVisibility);

function refreshDashboard() {
  updateDashboards();
  redrawRecentUploads();
}

function redrawRecentUploads() {
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
      <td>${escapeHTML(item.uploadMode === "package" ? "Single ZIP" : "Separate Files")}</td>
      <td>${item.files.map(escapeHTML).join(", ")}</td>
      <td>${escapeHTML(item.gcsPath || item.localPath || "-")}</td>
      <td>${escapeHTML(item.status)}</td>
    `;
    recentBody.appendChild(row);
  });
}

function updateDashboards() {
  let stageCounts = { "1": 0, "2": 0, "3": 0, "4": 0 };
  let diabeticYes = 0;
  let diabeticNo = 0;
  let ageBuckets = [];
  let summaryHospitals = 0;
  let summaryFindings = 0;
  let summaryVideos = 0;

  const dashboardItems = state.recentUploads || [];

  if (USE_DUMMY_DASHBOARD) {
    summaryHospitals = dummyDashboard.summary.hospitals;
    summaryFindings = dummyDashboard.summary.findings;
    stageCounts = { ...dummyDashboard.stages };
    diabeticYes = dummyDashboard.diabetic.yes;
    diabeticNo = dummyDashboard.diabetic.no;
    ageBuckets = dummyDashboard.ageBuckets;
  } else {
    dashboardItems.forEach((item) => {
      stageCounts[item.ckdStage] = (stageCounts[item.ckdStage] || 0) + 1;
      if (item.diabetic === "Yes") {
        diabeticYes += 1;
      } else {
        diabeticNo += 1;
      }
    });

    summaryHospitals = hospitals.length;
    summaryFindings = dashboardItems.length;
    ageBuckets = buildAgeBuckets(dashboardItems);
    summaryVideos = dashboardItems.filter((item) => item.hasVideo).length;
  }

  const summaryHospitalsEl = document.getElementById("summary-hospitals");
  const summaryFindingsEl = document.getElementById("summary-findings");
  if (summaryHospitalsEl) summaryHospitalsEl.textContent = summaryHospitals;
  if (summaryFindingsEl) summaryFindingsEl.textContent = summaryFindings;
  if (summaryVideosEl) summaryVideosEl.textContent = summaryVideos;
  if (dashboardUpdatedAt) {
    const latest = (state.recentUploads || [])[0]?.completedAt;
    dashboardUpdatedAt.textContent = latest ? `Latest Upload: ${new Date(latest).toLocaleString()}` : "Awaiting live submissions";
  }

  renderDonut("ckd-stage-donut", "ckd-stage-center", "ckd-stage-legend", [
    { label: "Stage 1", value: stageCounts["1"], color: "#2dd4bf" },
    { label: "Stage 2", value: stageCounts["2"], color: "#60a5fa" },
    { label: "Stage 3", value: stageCounts["3"], color: "#fbbf24" },
    { label: "Stage 4", value: stageCounts["4"], color: "#f87171" }
  ], String(dashboardItems.length || Object.values(stageCounts).reduce((sum, val) => sum + val, 0)));
  renderHistogram("age-histogram", ageBuckets);
  renderDonut("diabetic-donut", "diabetic-center", "diabetic-legend", [
    { label: "CKD Diabetic", value: diabeticYes, color: "#0f9a87" },
    { label: "CKD Non-Diabetic", value: diabeticNo, color: "#94a3b8" }
  ]);
}

function renderDonut(donutId, centerId, legendId, segments, centerValue) {
  const donut = document.getElementById(donutId);
  const center = document.getElementById(centerId);
  const legend = document.getElementById(legendId);
  if (!donut || !center || !legend) {
    return;
  }

  const total = segments.reduce((sum, seg) => sum + seg.value, 0) || 1;
  let current = 0;
  const gradientParts = segments.map((segment) => {
    const start = (current / total) * 360;
    current += segment.value;
    const end = (current / total) * 360;
    return `${segment.color} ${start}deg ${end}deg`;
  });

  donut.style.background = `conic-gradient(${gradientParts.join(", ")})`;
  center.textContent = centerValue ?? `${Math.round((segments[0].value / total) * 100)}%`;

  legend.innerHTML = "";
  segments.forEach((segment) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <span class="legend-dot" style="background:${segment.color}"></span>
      <span>${segment.label} (${segment.value})</span>
    `;
    legend.appendChild(item);
  });
}

function renderHistogram(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = "<p class=\"empty\">No data available.</p>";
    return;
  }

  const palette = ["#0f9a87", "#3b82f6", "#f59e0b", "#6366f1", "#10b981", "#ef4444", "#14b8a6", "#8b5cf6"];
  const maxValue = Math.max(...items.map((item) => item.value), 1);
  container.innerHTML = "";

  items.forEach((item, index) => {
    const col = document.createElement("div");
    col.className = "histogram-col";
    const height = Math.max((item.value / maxValue) * 160, 18);
    col.innerHTML = `
      <div class="histogram-value">${item.value}</div>
      <div class="histogram-bar" style="height:${height}px; background:${palette[index % palette.length]};"></div>
      <div class="histogram-label">${item.label}</div>
    `;
    container.appendChild(col);
  });
}

function buildAgeBuckets(items) {
  const buckets = [
    { label: "18-29", min: 18, max: 29, value: 0 },
    { label: "30-39", min: 30, max: 39, value: 0 },
    { label: "40-49", min: 40, max: 49, value: 0 },
    { label: "50-59", min: 50, max: 59, value: 0 },
    { label: "60-69", min: 60, max: 69, value: 0 },
    { label: "70-79", min: 70, max: 79, value: 0 },
    { label: "80+", min: 80, max: Infinity, value: 0 }
  ];

  items.forEach((item) => {
    const age = Number(item.age);
    const bucket = buckets.find((b) => age >= b.min && age <= b.max);
    if (bucket) {
      bucket.value += 1;
    }
  });

  return buckets.map(({ label, value }) => ({ label, value }));
}

function setUploadProgress(progress, label) {
  const normalizedProgress = Math.max(0, Math.min(100, Math.round(progress)));
  state.uploadProgress = normalizedProgress;
  uploadProgressPanel.classList.remove("hidden");
  uploadProgressFill.style.width = `${normalizedProgress}%`;
  uploadProgressPercent.textContent = `${normalizedProgress}%`;
  uploadProgressLabel.textContent = label;

  if (state.pendingSubmission) {
    state.pendingSubmission = {
      ...state.pendingSubmission,
      progress: normalizedProgress,
      status: normalizedProgress >= 100 ? "Submitted" : "Uploading"
    };
  }

  refreshDashboard();
}

function resetUploadProgress() {
  state.uploadProgress = 0;
  uploadProgressFill.style.width = "0%";
  uploadProgressPercent.textContent = "0%";
  uploadProgressLabel.textContent = "Preparing upload";
  uploadProgressPanel.classList.add("hidden");
}

function buildSubmissionFormData(timestamp, submission) {
  const formData = new FormData();
  const submissions = [submission].map((item, index) => {
    const { uploadFiles, ...metadata } = item;
    uploadFiles.forEach((upload) => {
      formData.append(`file_${index}_${upload.fieldName}`, upload.file, upload.file.name);
    });
    return {
      ...metadata,
      reviewed_at: timestamp,
      files: uploadFiles.map((upload) => ({
        fieldName: upload.fieldName,
        name: upload.file.name,
        type: upload.file.type || "application/octet-stream",
        size: upload.file.size
      }))
    };
  });

  formData.append("payload", JSON.stringify({ timestamp, submissions }));
  return formData;
}

function sendSubmission(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/submissions");

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        return;
      }
      setUploadProgress((event.loaded / event.total) * 100, "Uploading record to cloud storage");
    });

    xhr.addEventListener("load", () => {
      let result = {};
      try {
        result = JSON.parse(xhr.responseText || "{}");
      } catch {
        reject(new Error("Server returned an unreadable response."));
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300 || !result.ok) {
        reject(new Error(result.error || "Submission failed."));
        return;
      }
      resolve(result);
    });

    xhr.addEventListener("error", () => reject(new Error("Network error while uploading.")));
    xhr.addEventListener("timeout", () => reject(new Error("Upload timed out.")));
    xhr.timeout = 30 * 60 * 1000;
    xhr.send(formData);
  });
}

function buildSubmissionFromForm() {
  const selectedHospital = hospitals.find((hospital) => hospital.id === hospitalNameInput.value);
  const uploadMode = getUploadMode();
  const hospitalId = hospitalIdInput.value.trim();
  const hospitalName = selectedHospital?.name || "";
  const uhid = uhidInput.value.trim();
  const age = ageInput.value.trim();
  const sex = sexInput.value;
  const weight = weightInput.value.trim();
  const ckdStage = ckdStageInput.value;
  const dialysis = dialysisInput.value;
  const dialysisFrequency = dialysisFrequencyInput.value.trim();
  const diabetic = diabeticInput.value;
  const diabeticStage = diabeticStageInput.value.trim();
  const leftKidneyFile = leftKidneyFileInput.files[0];
  const rightKidneyFile = rightKidneyFileInput.files[0];
  const egfrReportFile = egfrReportInput.files[0];
  const patientPackageFile = patientPackageFileInput.files[0];
  const ultrasoundVideoFile = ultrasoundVideoFileInput.files[0];

  if (!hospitalName || !hospitalId || !uhid) {
    showToast("Hospital, Hospital ID, and UHID are required.");
    return null;
  }

  if (!age || !sex || !weight) {
    showToast("Age, sex, and weight are required.");
    return null;
  }

  if (Number(age) < 18) {
    showToast("Patient age must be 18 or above.");
    return null;
  }

  if (!ckdStage) {
    showToast("Select CKD stage.");
    return null;
  }

  if ((ckdStage === "3" || ckdStage === "4") && !dialysis) {
    showToast("Select dialysis status for CKD stage 3 or 4.");
    return null;
  }

  if ((ckdStage === "3" || ckdStage === "4") && dialysis === "Yes" && !dialysisFrequency) {
    showToast("Enter dialysis frequency per week.");
    return null;
  }

  if (!diabetic) {
    showToast("Select diabetic status.");
    return null;
  }

  if (diabetic === "Yes" && !diabeticStage) {
    showToast("Enter diabetic stage.");
    return null;
  }

  let uploadFiles = [];

  if (uploadMode === "separate") {
    if (!leftKidneyFile || !rightKidneyFile) {
      showToast("Upload both left and right kidney files.");
      return null;
    }

    if (!egfrReportFile) {
      showToast("Upload the eGFR report.");
      return null;
    }

    uploadFiles = [
      { fieldName: "leftKidney", file: leftKidneyFile },
      { fieldName: "rightKidney", file: rightKidneyFile },
      { fieldName: "egfrReport", file: egfrReportFile }
    ];
  } else {
    if (!patientPackageFile) {
      showToast("Upload the patient ZIP package.");
      return null;
    }

    uploadFiles = [
      { fieldName: "patientPackage", file: patientPackageFile }
    ];
  }

  if (ultrasoundVideoFile) {
    uploadFiles.push({ fieldName: "ultrasoundVideo", file: ultrasoundVideoFile });
  }

  const totalBytes = uploadFiles.reduce((sum, upload) => sum + upload.file.size, 0);

  return {
    hospitalId,
    hospitalName,
    uploadMode,
    uhid,
    age,
    sex,
    weight,
    ckdStage,
    dialysis: ckdStage === "3" || ckdStage === "4" ? dialysis : "-",
    dialysisFrequency: ckdStage === "3" || ckdStage === "4" && dialysis === "Yes" ? dialysisFrequency : "-",
    diabetic,
    diabeticStage: diabetic === "Yes" ? diabeticStage : "-",
    files: uploadFiles.map((upload) => upload.file.name),
    fileCount: uploadFiles.length,
    totalBytes,
    hasVideo: Boolean(ultrasoundVideoFile),
    uploadFiles,
    progress: 0,
    status: "Pending Review",
    reviewedAt: new Date().toISOString()
  };
}

function renderReviewSubmission(submission) {
  const detailRows = [
    ["Hospital", submission.hospitalName],
    ["Hospital ID", submission.hospitalId],
    ["Patient ID", submission.uhid],
    ["Upload Method", submission.uploadMode === "package" ? "Single ZIP Package" : "Separate Files"],
    ["Age", submission.age],
    ["Sex", submission.sex],
    ["Weight", `${submission.weight} kg`],
    ["CKD Stage", `Stage ${submission.ckdStage}`],
    ["Dialysis", submission.dialysis || "-"],
    ["Dialysis / Week", submission.dialysisFrequency || "-"],
    ["Diabetic", submission.diabetic],
    ["Diabetes Classification", submission.diabeticStage || "-"]
  ];

  const fileRows = submission.uploadFiles.map((upload) => `
    <div class="review-file">
      <span>${escapeHTML(getUploadLabel(upload.fieldName))}</span>
      <strong>${escapeHTML(upload.file.name)}</strong>
      <small>${escapeHTML(upload.file.type || "Unknown type")} • ${formatBytes(upload.file.size)}</small>
    </div>
  `).join("");

  reviewContent.innerHTML = `
    <div class="review-alert">
      Please confirm these details. After you proceed, this record uploads directly to the VM and Cloud Storage.
    </div>
    <div class="review-grid">
      ${detailRows.map(([label, value]) => `
        <div class="review-item">
          <span>${escapeHTML(label)}</span>
          <strong>${escapeHTML(value)}</strong>
        </div>
      `).join("")}
    </div>
    <div class="review-files">
      <h3>Selected Files (${submission.fileCount})</h3>
      ${fileRows}
      <div class="review-total">Total upload size: ${formatBytes(submission.totalBytes)}</div>
    </div>
  `;
}

function showReviewSubmission(submission) {
  state.pendingSubmission = submission;
  renderReviewSubmission(submission);
  reviewProceedBtn.disabled = false;
  reviewProceedBtn.textContent = "Proceed & Upload";
  reviewModal.classList.remove("hidden");
  refreshDashboard();
}

function closeReviewSubmission({ keepPending = false } = {}) {
  reviewModal.classList.add("hidden");
  if (!keepPending) {
    state.pendingSubmission = null;
    refreshDashboard();
  }
}

function resetEgfrForm() {
  egfrForm.reset();
  hospitalIdInput.value = "";
  clearFilePreviews();
  updateUploadModeVisibility();
  updateDialysisVisibility();
  updateDiabeticVisibility();
}

egfrForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const submission = buildSubmissionFromForm();
  if (!submission) {
    return;
  }
  showReviewSubmission(submission);
});

updateDialysisVisibility();
updateDiabeticVisibility();
refreshDashboard();

async function uploadReviewedSubmission() {
  if (!state.pendingSubmission) {
    showToast("No record is waiting for review.");
    return;
  }

  if (window.location.protocol === "file:") {
    showToast("Run with npm start before sending records.");
    return;
  }

  reviewProceedBtn.disabled = true;
  reviewEditBtn.disabled = true;
  reviewCloseBtn.disabled = true;
  reviewProceedBtn.textContent = "Uploading...";
  setUploadProgress(0, "Preparing direct upload");

  try {
    const timestamp = new Date().toISOString();
    const submission = state.pendingSubmission;
    const result = await sendSubmission(buildSubmissionFormData(timestamp, submission));
    setUploadProgress(100, "Upload complete");

    showToast(result.gcsSynced ? "Submission saved to VM and GCS." : "Submission saved to VM. Configure GCS_BUCKET for cloud sync.");

    const { uploadFiles, ...recentItem } = submission;
    state.recentUploads = [
      {
        ...recentItem,
        status: result.gcsSynced ? "Uploaded" : "Saved to VM",
        batchId: result.batchId,
        gcsPath: result.gcsPath,
        localPath: result.localPath,
        completedAt: new Date().toISOString()
      },
      ...(state.recentUploads || [])
    ];
    closeReviewSubmission({ keepPending: true });
    state.pendingSubmission = null;
    resetEgfrForm();
    refreshDashboard();
    activateTab("dashboard");
  } catch (err) {
    state.pendingSubmission = {
      ...state.pendingSubmission,
      status: "Failed"
    };
    refreshDashboard();
    showToast("Failed to submit: " + err.message);
  } finally {
    reviewProceedBtn.disabled = false;
    reviewEditBtn.disabled = false;
    reviewCloseBtn.disabled = false;
    reviewProceedBtn.textContent = "Proceed & Upload";
    window.setTimeout(resetUploadProgress, 1800);
  }
}

reviewEditBtn.addEventListener("click", () => closeReviewSubmission());
reviewCloseBtn.addEventListener("click", () => closeReviewSubmission());
reviewModal.addEventListener("click", (event) => {
  if (event.target === reviewModal) {
    closeReviewSubmission();
  }
});
reviewProceedBtn.addEventListener("click", uploadReviewedSubmission);

populateHospitals();
initializeFilePreviews();
updateUploadModeVisibility();
