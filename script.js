const state = {
  queue: []
};

const tabs = document.querySelectorAll(".nav-link[data-tab]");
const panels = {
  egfr: document.getElementById("tab-egfr"),
  dashboard: document.getElementById("tab-dashboard")
};

const egfrForm = document.getElementById("egfr-form");
const queueBody = document.getElementById("queue-body");

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
const leftKidneyFileInput = document.getElementById("left-kidney-file");
const rightKidneyFileInput = document.getElementById("right-kidney-file");
const egfrReportInput = document.getElementById("egfr-report");
const toast = document.getElementById("toast");

const submitFirebaseBtn = document.getElementById("submit-to-firebase");
const clearQueueBtn = document.getElementById("clear-queue");

const USE_DUMMY_DASHBOARD = true;
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

function redrawQueue() {
  queueBody.innerHTML = "";

  if (state.queue.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="12" class="empty">No submissions queued yet.</td>';
    queueBody.appendChild(row);
    updateDashboards();
    return;
  }

  state.queue.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.hospitalId}</td>
      <td>${item.uhid}</td>
      <td>${item.age}</td>
      <td>${item.sex}</td>
      <td>${item.weight}</td>
      <td>${item.ckdStage}</td>
      <td>${item.dialysis || "-"}</td>
      <td>${item.dialysisFrequency || "-"}</td>
      <td>${item.diabetic}</td>
      <td>${item.diabeticStage || "-"}</td>
      <td>${item.files.join(", ")}</td>
      <td>${item.status}</td>
    `;
    queueBody.appendChild(row);
  });

  updateDashboards();
}

function updateDashboards() {
  let stageCounts = { "1": 0, "2": 0, "3": 0, "4": 0 };
  let diabeticYes = 0;
  let diabeticNo = 0;
  let dialysisYes = 0;
  let dialysisNo = 0;
  let stage34Yes = 0;
  let stage34No = 0;
  let hospitalCounts = new Map();
  let patientSet = new Set();
  let monthlyData = [];
  let ageBuckets = [];
  let summaryPatients = 0;
  let summaryHospitals = 0;
  let summaryFindings = 0;

  if (USE_DUMMY_DASHBOARD) {
    summaryPatients = dummyDashboard.summary.patients;
    summaryHospitals = dummyDashboard.summary.hospitals;
    summaryFindings = dummyDashboard.summary.findings;
    stageCounts = { ...dummyDashboard.stages };
    diabeticYes = dummyDashboard.diabetic.yes;
    diabeticNo = dummyDashboard.diabetic.no;
    dialysisYes = dummyDashboard.dialysis.yes;
    dialysisNo = dummyDashboard.dialysis.no;
    stage34Yes = dummyDashboard.stage34.yes;
    stage34No = dummyDashboard.stage34.no;
    monthlyData = dummyDashboard.monthly;
    ageBuckets = dummyDashboard.ageBuckets;
  } else {
    state.queue.forEach((item) => {
      patientSet.add(item.uhid);
      stageCounts[item.ckdStage] = (stageCounts[item.ckdStage] || 0) + 1;
      if (item.diabetic === "Yes") {
        diabeticYes += 1;
      } else {
        diabeticNo += 1;
      }

      if (item.ckdStage === "3" || item.ckdStage === "4") {
        stage34Yes += 1;
      } else {
        stage34No += 1;
      }

      if (item.dialysis === "Yes") {
        dialysisYes += 1;
      } else if (item.dialysis === "No") {
        dialysisNo += 1;
      }

      const count = hospitalCounts.get(item.hospitalId) || 0;
      hospitalCounts.set(item.hospitalId, count + 1);
    });

    summaryPatients = patientSet.size;
    summaryHospitals = hospitalCounts.size;
    summaryFindings = stage34Yes;
    ageBuckets = buildAgeBuckets(state.queue);
  }

  const hospitalData = USE_DUMMY_DASHBOARD
    ? dummyDashboard.hospitals
    : Array.from(hospitalCounts.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

  const summaryPatientsEl = document.getElementById("summary-patients");
  const summaryHospitalsEl = document.getElementById("summary-hospitals");
  const summaryFindingsEl = document.getElementById("summary-findings");
  if (summaryPatientsEl) summaryPatientsEl.textContent = summaryPatients;
  if (summaryHospitalsEl) summaryHospitalsEl.textContent = summaryHospitals;
  if (summaryFindingsEl) summaryFindingsEl.textContent = summaryFindings;

  renderBarList("month-bars", monthlyData, "#5f6c86");
  renderDonut("ckd-stage-donut", "ckd-stage-center", "ckd-stage-legend", [
    { label: "Stage 1", value: stageCounts["1"], color: "#2dd4bf" },
    { label: "Stage 2", value: stageCounts["2"], color: "#60a5fa" },
    { label: "Stage 3", value: stageCounts["3"], color: "#fbbf24" },
    { label: "Stage 4", value: stageCounts["4"], color: "#f87171" }
  ], String(summaryPatients || Object.values(stageCounts).reduce((sum, val) => sum + val, 0)));
  renderHistogram("age-histogram", ageBuckets);
  renderDonut("diabetic-donut", "diabetic-center", "diabetic-legend", [
    { label: "Diabetic", value: diabeticYes, color: "#0f9a87" },
    { label: "Non-diabetic", value: diabeticNo, color: "#94a3b8" }
  ]);
  renderStackedBar("dialysis-bar", "dialysis-legend", [
    { label: "Dialysis Yes", value: dialysisYes, color: "#ef4444" },
    { label: "Dialysis No", value: dialysisNo, color: "#10b981" }
  ]);
  renderHospitalBars(hospitalData);
}

function renderStackedBar(barId, legendId, segments, totalOverride) {
  const bar = document.getElementById(barId);
  const legend = document.getElementById(legendId);
  if (!bar || !legend) {
    return;
  }

  const total = (totalOverride ?? segments.reduce((sum, seg) => sum + seg.value, 0)) || 1;
  bar.innerHTML = "";
  legend.innerHTML = "";

  segments.forEach((segment) => {
    const width = Math.max((segment.value / total) * 100, 2);
    const div = document.createElement("div");
    div.className = "stacked-segment";
    div.style.width = `${width}%`;
    div.style.background = segment.color;
    bar.appendChild(div);

    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `
      <span class="legend-dot" style="background:${segment.color}"></span>
      <span>${segment.label} (${segment.value})</span>
    `;
    legend.appendChild(item);
  });
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

function renderBarList(containerId, items, color) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  if (!items.length) {
    container.innerHTML = "<p class=\"empty\">No data available.</p>";
    return;
  }

  const maxValue = Math.max(...items.map((item) => item.value), 1);
  container.innerHTML = "";
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "bar-item";
    row.innerHTML = `
      <div class="bar-label">
        <span>${item.label}</span>
        <span>${item.value}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${(item.value / maxValue) * 100}%; background:${color};"></div>
      </div>
    `;
    container.appendChild(row);
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
    { label: "10-19", min: 10, max: 19, value: 0 },
    { label: "20-29", min: 20, max: 29, value: 0 },
    { label: "30-39", min: 30, max: 39, value: 0 },
    { label: "40-49", min: 40, max: 49, value: 0 },
    { label: "50-59", min: 50, max: 59, value: 0 },
    { label: "60-69", min: 60, max: 69, value: 0 },
    { label: "70-79", min: 70, max: 79, value: 0 },
    { label: "80-89", min: 80, max: 89, value: 0 }
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

function renderHospitalBars(hospitals) {
  const container = document.getElementById("hospital-bars");
  if (!container) {
    return;
  }

  if (!hospitals.length) {
    container.innerHTML = "<p class=\"empty\">No data available.</p>";
    return;
  }

  const maxValue = Math.max(...hospitals.map((item) => item.value), 1);
  container.innerHTML = "";

  hospitals.forEach((item) => {
    const card = document.createElement("div");
    card.className = "hospital-item";
    card.innerHTML = `
      <div class="hospital-header">
        <span>${item.name}</span>
        <span class="hospital-count">${item.value}</span>
      </div>
      <div class="hospital-track">
        <div class="hospital-fill" style="width:${(item.value / maxValue) * 100}%"></div>
      </div>
    `;
    container.appendChild(card);
  });
}

function fileToSubmissionPayload(fieldName, file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result || "");
      const contentBase64 = result.includes(",") ? result.split(",")[1] : "";
      resolve({
        fieldName,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        contentBase64
      });
    });
    reader.addEventListener("error", () => reject(new Error(`Could not read ${file.name}`)));
    reader.readAsDataURL(file);
  });
}

egfrForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const hospitalId = hospitalIdInput.value.trim();
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

  if (!hospitalId || !uhid) {
    showToast("Hospital ID and UHID are required.");
    return;
  }

  if (!age || !sex || !weight) {
    showToast("Age, sex, and weight are required.");
    return;
  }

  if (!ckdStage) {
    showToast("Select CKD stage.");
    return;
  }

  if ((ckdStage === "3" || ckdStage === "4") && !dialysis) {
    showToast("Select dialysis status for CKD stage 3 or 4.");
    return;
  }

  if ((ckdStage === "3" || ckdStage === "4") && dialysis === "Yes" && !dialysisFrequency) {
    showToast("Enter dialysis frequency per week.");
    return;
  }

  if (!diabetic) {
    showToast("Select diabetic status.");
    return;
  }

  if (diabetic === "Yes" && !diabeticStage) {
    showToast("Enter diabetic stage.");
    return;
  }

  if (!leftKidneyFile || !rightKidneyFile) {
    showToast("Upload both left and right kidney files.");
    return;
  }

  if (!egfrReportFile) {
    showToast("Upload the eGFR report.");
    return;
  }

  state.queue.unshift({
    hospitalId,
    uhid,
    age,
    sex,
    weight,
    ckdStage,
    dialysis: ckdStage === "3" || ckdStage === "4" ? dialysis : "-",
    dialysisFrequency: ckdStage === "3" || ckdStage === "4" && dialysis === "Yes" ? dialysisFrequency : "-",
    diabetic,
    diabeticStage: diabetic === "Yes" ? diabeticStage : "-",
    files: [leftKidneyFile.name, rightKidneyFile.name, egfrReportFile.name],
    uploadFiles: [
      { fieldName: "leftKidney", file: leftKidneyFile },
      { fieldName: "rightKidney", file: rightKidneyFile },
      { fieldName: "egfrReport", file: egfrReportFile }
    ],
    status: "Queued"
  });

  redrawQueue();
  egfrForm.reset();
  updateDialysisVisibility();
  updateDiabeticVisibility();
  showToast("eGFR submission queued successfully.");
  activateTab("dashboard");
});

updateDialysisVisibility();
updateDiabeticVisibility();
redrawQueue();

async function submitToFirebase() {
  if (state.queue.length === 0) {
    showToast("No submissions to send. Queue is empty.");
    return;
  }

  if (window.location.protocol === "file:") {
    showToast("Run with npm start before sending records.");
    return;
  }

  submitFirebaseBtn.disabled = true;
  submitFirebaseBtn.textContent = "Submitting...";

  try {
    const timestamp = new Date().toISOString();
    const submission = {
      timestamp,
      submissions: await Promise.all(
        state.queue.map(async (item) => {
          const { uploadFiles, ...metadata } = item;
          return {
            ...metadata,
            queued_at: timestamp,
            files: await Promise.all(
              uploadFiles.map((upload) => fileToSubmissionPayload(upload.fieldName, upload.file))
            )
          };
        })
      )
    };

    const response = await fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission)
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Submission failed.");
    }

    showToast(result.gcsSynced ? "Submission saved to VM and GCS." : "Submission saved to VM. Configure GCS_BUCKET for cloud sync.");

    state.queue = [];
    redrawQueue();
  } catch (err) {
    showToast("Failed to submit: " + err.message);
  } finally {
    submitFirebaseBtn.disabled = false;
    submitFirebaseBtn.textContent = "Submit All to VM / GCS";
  }
}

clearQueueBtn.addEventListener("click", () => {
  if (state.queue.length === 0) {
    showToast("Queue is already empty.");
    return;
  }
  state.queue = [];
  redrawQueue();
  showToast("Queue cleared.");
});

submitFirebaseBtn.addEventListener("click", submitToFirebase);
