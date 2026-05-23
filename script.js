const state = {
  pendingSubmission: null,
  recentUploads: [],
  uploadProgress: 0,
  hospitalSession: null,
  backendDashboard: null
};

const HOSPITAL_SESSION_KEY = "renalPortalHospitalSession";

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
  landing: document.getElementById("tab-landing"),
  consent: document.getElementById("tab-consent"),
  questionnaire: document.getElementById("tab-questionnaire"),
  egfr: document.getElementById("tab-egfr"),
  dashboard: document.getElementById("tab-dashboard")
};

const egfrForm = document.getElementById("egfr-form");
const questionnaireForm = document.getElementById("questionnaire-form");
const recentBody = document.getElementById("recent-body");
const consentNav = document.getElementById("consent-nav");
const questionnaireNav = document.getElementById("questionnaire-nav");
const egfrNav = document.getElementById("egfr-nav");
const landingScrollSetupBtn = document.getElementById("landing-scroll-setup");
const hospitalSessionForm = document.getElementById("hospital-session-form");
const patientStartForm = document.getElementById("patient-start-form");
const intakeWorkspace = document.getElementById("intake-workspace");
const landingHospitalInput = document.getElementById("landing-hospital");
const landingHospitalIdInput = document.getElementById("landing-hospital-id");
const landingUhidInput = document.getElementById("landing-uhid");
const landingStudyIdInput = document.getElementById("landing-study-id");
const landingEnrollmentDateInput = document.getElementById("landing-enrollment-date");
const startPatientConsentBtn = document.getElementById("start-patient-consent");
const activeHospitalName = document.getElementById("active-hospital-name");
const activeHospitalId = document.getElementById("active-hospital-id");
const consentCheckbox = document.getElementById("consent-checkbox");
const consentContinueBtn = document.getElementById("consent-continue");
const questionnaireContinueBtn = document.getElementById("questionnaire-continue");
const questionnaireHeightInput = document.getElementById("questionnaire-height");
const questionnaireWeightInput = document.getElementById("patient-weight");
const questionnaireBmiInput = document.getElementById("questionnaire-bmi");
const syncChoiceInputs = document.querySelectorAll("[data-sync-target]");

const studyIdInput = document.getElementById("study-id");
const hospitalNameInput = document.getElementById("hospital-name");
const hospitalIdInput = document.getElementById("hospital-id");
const uhidInput = document.getElementById("uhid");
const enrollmentDateInput = document.getElementById("enrollment-date");
const siteCenterInput = document.getElementById("site-center");
const consentObtainedInputs = document.querySelectorAll("input[name='consentObtained']");
const ageInput = document.getElementById("patient-age");
const sexInput = document.getElementById("patient-sex");
const heightInput = document.getElementById("questionnaire-height");
const weightInput = document.getElementById("patient-weight");
const bmiInput = document.getElementById("questionnaire-bmi");
const ethnicityInput = document.getElementById("ethnicity");
const occupationInput = document.getElementById("occupation");
const knownCkdInputs = document.querySelectorAll("input[name='knownCkd']");
const ckdDurationInput = document.getElementById("ckd-duration");
const ckdStageInput = document.getElementById("ckd-stage");
const dialysisBlock = document.getElementById("dialysis-block");
const dialysisInput = document.getElementById("dialysis-yes-no");
const dialysisFrequencyInput = document.getElementById("dialysis-frequency");
const diabeticInput = document.getElementById("diabetic-yes-no");
const diabeticStageBlock = document.getElementById("diabetic-stage-block");
const diabeticStageInput = document.getElementById("diabetic-stage");
const diabetesDurationInput = document.getElementById("diabetes-duration");
const hypertensionInputs = document.querySelectorAll("input[name='hypertension']");
const hypertensionDurationInput = document.getElementById("hypertension-duration");
const cardiovascularDiseaseInputs = document.querySelectorAll("input[name='cardiovascularDisease']");
const familyKidneyHistoryInputs = document.querySelectorAll("input[name='familyKidneyHistory']");
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
const consentContextPatient = document.getElementById("consent-context-patient");
const consentContextHospital = document.getElementById("consent-context-hospital");
const consentContextHospitalId = document.getElementById("consent-context-hospital-id");
const consentContextUhid = document.getElementById("consent-context-uhid");
const consentContextDate = document.getElementById("consent-context-date");
const linkedPatientTitle = document.getElementById("linked-patient-title");
const linkedHospital = document.getElementById("linked-hospital");
const linkedHospitalId = document.getElementById("linked-hospital-id");
const linkedUhid = document.getElementById("linked-uhid");
const linkedAgeSex = document.getElementById("linked-age-sex");
const linkedCkd = document.getElementById("linked-ckd");
const linkedDiabetic = document.getElementById("linked-diabetic");
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
    [landingHospitalInput, hospitalNameInput].forEach((select) => {
      const option = document.createElement("option");
      option.value = hospital.id;
      option.textContent = hospital.name;
      option.dataset.name = hospital.name;
      select.appendChild(option);
    });
  });
}

function updateHospitalId() {
  hospitalIdInput.value = hospitalNameInput.value || "";
  updateConsentContext();
  updateLinkedPatientSummary();
}

function updateLandingHospitalId() {
  landingHospitalIdInput.value = landingHospitalInput.value || "";
}

function getSelectedLandingHospital() {
  return hospitals.find((hospital) => hospital.id === landingHospitalInput.value) || null;
}

function setPatientFieldsEnabled(isEnabled) {
  [landingUhidInput, landingStudyIdInput, landingEnrollmentDateInput, startPatientConsentBtn].forEach((input) => {
    input.disabled = !isEnabled;
  });
}

function updateHospitalSessionUI() {
  const session = state.hospitalSession;
  const hasSession = Boolean(session);

  activeHospitalName.textContent = session?.name || "No hospital selected";
  activeHospitalId.textContent = session ? `Hospital ID: ${session.id}` : "Save hospital session first";
  setPatientFieldsEnabled(hasSession);
}

function saveHospitalSession() {
  const hospital = getSelectedLandingHospital();
  if (!hospital) {
    showToast("Select a hospital before saving the session.");
    return false;
  }

  const session = { id: hospital.id, name: hospital.name };
  state.hospitalSession = session;
  try {
    sessionStorage.setItem(HOSPITAL_SESSION_KEY, JSON.stringify(session));
  } catch {
  }

  updateHospitalSessionUI();
  showToast("Hospital session saved. You can now add patients.");
  return true;
}

function loadHospitalSession() {
  let storedSession = null;
  try {
    storedSession = JSON.parse(sessionStorage.getItem(HOSPITAL_SESSION_KEY) || "null");
  } catch {
    storedSession = null;
  }

  if (storedSession?.id && hospitals.some((hospital) => hospital.id === storedSession.id)) {
    landingHospitalInput.value = storedSession.id;
    state.hospitalSession = storedSession;
    updateLandingHospitalId();
  }

  updateHospitalSessionUI();
}

function syncChoiceValue(input) {
  const target = document.getElementById(input.dataset.syncTarget);
  if (!target) {
    return;
  }

  target.value = input.value;
  target.dispatchEvent(new Event("change", { bubbles: true }));
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

function getCheckedValue(inputs) {
  return Array.from(inputs).find((input) => input.checked)?.value || "";
}

function cleanIdentifier(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80);
}

function cleanDecimalValue(value, { integer = false } = {}) {
  const match = String(value || "").match(/\d+(\.\d*)?|\.\d*/);
  if (!match) {
    return "";
  }

  const normalized = match[0].startsWith(".") ? `0${match[0]}` : match[0];
  const [whole, ...decimalParts] = normalized.split(".");
  if (integer || !decimalParts.length) {
    return whole;
  }
  return `${whole}.${decimalParts.join("").slice(0, 2)}`;
}

function setFieldError(input, message) {
  input.setCustomValidity(message);
  if (message) {
    showToast(message);
  }
}

function validateNumericInput(input) {
  if (!input.value) {
    input.setCustomValidity("");
    return true;
  }

  const value = Number(input.value);
  const min = input.min === "" ? 0 : Number(input.min);
  const max = input.max === "" ? Number.POSITIVE_INFINITY : Number(input.max);
  const isInteger = input.step === "1";
  if (!Number.isFinite(value) || value < min || value > max || (isInteger && !Number.isInteger(value))) {
    const label = input.closest(".field-block")?.querySelector("label")?.textContent?.replace("*", "").trim() || "This field";
    setFieldError(input, `${label} must be a valid ${isInteger ? "whole " : ""}number between ${min} and ${Number.isFinite(max) ? max : "the allowed limit"}.`);
    return false;
  }

  input.setCustomValidity("");
  return true;
}

function validateDateInput(input) {
  if (!input.value) {
    input.setCustomValidity("");
    return true;
  }

  const selectedDate = new Date(`${input.value}T00:00:00`);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (Number.isNaN(selectedDate.getTime()) || selectedDate > today) {
    setFieldError(input, "Date of enrollment cannot be in the future.");
    return false;
  }

  input.setCustomValidity("");
  return true;
}

function initializeGlobalValidation() {
  document.querySelectorAll("input[type='number']").forEach((input) => {
    input.inputMode = input.step === "1" ? "numeric" : "decimal";
    input.addEventListener("keydown", (event) => {
      if (["e", "E", "+", "-"].includes(event.key)) {
        event.preventDefault();
      }
    });
    input.addEventListener("input", () => {
      const cleaned = cleanDecimalValue(input.value, { integer: input.step === "1" });
      if (input.value !== cleaned) {
        input.value = cleaned;
      }
      validateNumericInput(input);
    });
    input.addEventListener("blur", () => validateNumericInput(input));
  });

  [landingUhidInput, uhidInput].forEach((input) => {
    input.addEventListener("input", () => {
      const cleaned = cleanIdentifier(input.value);
      if (input.value !== cleaned) {
        input.value = cleaned;
      }
    });
  });

  [landingEnrollmentDateInput, enrollmentDateInput].forEach((input) => {
    input.addEventListener("change", () => validateDateInput(input));
  });
}

function updateLinkedPatientSummary() {
  const selectedHospital = hospitals.find((hospital) => hospital.id === hospitalNameInput.value);
  const hospitalName = selectedHospital?.name || "--";
  const patientId = uhidInput.value.trim() || "--";
  const ageSex = [ageInput.value.trim(), sexInput.value].filter(Boolean).join(" / ") || "--";

  linkedPatientTitle.textContent = patientId === "--" ? "No patient selected yet" : `Patient ${patientId}`;
  linkedHospital.textContent = hospitalName;
  linkedHospitalId.textContent = hospitalIdInput.value || "--";
  linkedUhid.textContent = patientId;
  linkedAgeSex.textContent = ageSex;
  linkedCkd.textContent = ckdStageInput.value ? `Stage ${ckdStageInput.value}` : "--";
  linkedDiabetic.textContent = diabeticInput.value || "--";
}

function formatDisplayDate(value) {
  if (!value) {
    return "--";
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function updateConsentContext() {
  const selectedHospital = hospitals.find((hospital) => hospital.id === hospitalNameInput.value);
  const hospitalName = selectedHospital?.name || "--";
  const patientId = uhidInput.value.trim() || "--";

  consentContextPatient.textContent = patientId === "--" ? "No patient selected" : `Patient ${patientId}`;
  consentContextHospital.textContent = hospitalName;
  consentContextHospitalId.textContent = hospitalIdInput.value || "--";
  consentContextUhid.textContent = patientId;
  consentContextDate.textContent = formatDisplayDate(document.getElementById("enrollment-date").value);
}

function syncIntakeToQuestionnaire() {
  hospitalNameInput.value = landingHospitalInput.value;
  studyIdInput.value = landingStudyIdInput.value.trim();
  hospitalIdInput.value = landingHospitalIdInput.value;
  uhidInput.value = landingUhidInput.value.trim();
  enrollmentDateInput.value = landingEnrollmentDateInput.value;
  updateConsentContext();
  updateLinkedPatientSummary();
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

  if (tabKey === "dashboard") {
    loadBackendDashboard();
  }
}

document.querySelectorAll("[data-tab-jump]").forEach((button) => {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tabJump);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

syncChoiceInputs.forEach((input) => {
  input.addEventListener("change", () => syncChoiceValue(input));
});

consentCheckbox.addEventListener("change", () => {
  consentContinueBtn.disabled = !consentCheckbox.checked;
});

landingScrollSetupBtn.addEventListener("click", () => {
  intakeWorkspace.scrollIntoView({ behavior: "smooth", block: "start" });
});

landingHospitalInput.addEventListener("change", () => {
  updateLandingHospitalId();
  state.hospitalSession = null;
  patientStartForm.reset();
  landingEnrollmentDateInput.value = new Date().toISOString().slice(0, 10);
  questionnaireForm.reset();
  hospitalNameInput.value = "";
  hospitalIdInput.value = "";
  uhidInput.value = "";
  consentNav.disabled = true;
  questionnaireNav.disabled = true;
  egfrNav.disabled = true;
  try {
    sessionStorage.removeItem(HOSPITAL_SESSION_KEY);
  } catch {
  }
  updateHospitalSessionUI();
  updateConsentContext();
  updateLinkedPatientSummary();
});

hospitalSessionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  updateLandingHospitalId();
  if (saveHospitalSession()) {
    landingUhidInput.focus();
  }
});

patientStartForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!state.hospitalSession) {
    showToast("Save the hospital session before adding patients.");
    landingHospitalInput.focus();
    return;
  }

  if (!landingUhidInput.value.trim()) {
    showToast("Enter Patient Unique ID before consent.");
    landingUhidInput.focus();
    return;
  }

  if (!validateDateInput(landingEnrollmentDateInput)) {
    landingEnrollmentDateInput.reportValidity();
    return;
  }

  syncIntakeToQuestionnaire();
  consentCheckbox.checked = false;
  consentContinueBtn.disabled = true;
  consentNav.disabled = false;
  questionnaireNav.disabled = true;
  egfrNav.disabled = true;
  activateTab("consent");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

consentContinueBtn.addEventListener("click", () => {
  if (!hospitalIdInput.value || !uhidInput.value.trim()) {
    showToast("Create the patient intake before accepting consent.");
    activateTab("landing");
    return;
  }

  questionnaireNav.disabled = false;
  activateTab("questionnaire");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

function updateQuestionnaireBmi() {
  const heightCm = Number(questionnaireHeightInput.value);
  const weightKg = Number(questionnaireWeightInput.value);
  if (!heightCm || !weightKg || heightCm < 30 || weightKg < 1) {
    questionnaireBmiInput.value = "";
    return;
  }

  const heightMeters = heightCm / 100;
  questionnaireBmiInput.value = (weightKg / (heightMeters * heightMeters)).toFixed(1);
}

function validateQuestionnaireForClinicalUpload() {
  if (!hospitalIdInput.value || !uhidInput.value.trim()) {
    showToast("Patient setup is required before clinical upload.");
    activateTab("landing");
    return false;
  }

  const numericInputs = [ageInput, heightInput, weightInput, dialysisFrequencyInput, diabetesDurationInput, hypertensionDurationInput]
    .filter((input) => input.value.trim());
  if (!numericInputs.every(validateNumericInput)) {
    return false;
  }

  if (!validateDateInput(enrollmentDateInput)) {
    enrollmentDateInput.reportValidity();
    return false;
  }

  if (!ageInput.value.trim() || Number(ageInput.value) < 18 || Number(ageInput.value) > 120) {
    showToast("Enter patient age, 18 years or above.");
    ageInput.focus();
    return false;
  }

  if (!sexInput.value) {
    showToast("Select patient sex.");
    return false;
  }

  if (!weightInput.value.trim() || Number(weightInput.value) < 1 || Number(weightInput.value) > 300) {
    showToast("Enter patient weight.");
    weightInput.focus();
    return false;
  }

  if (!ckdStageInput.value) {
    showToast("Select CKD stage.");
    ckdStageInput.focus();
    return false;
  }

  if ((ckdStageInput.value === "3" || ckdStageInput.value === "4") && !dialysisInput.value) {
    showToast("Select dialysis status for CKD stage 3 or 4.");
    return false;
  }

  if ((ckdStageInput.value === "3" || ckdStageInput.value === "4") && dialysisInput.value === "Yes" && !dialysisFrequencyInput.value.trim()) {
    showToast("Enter dialysis frequency.");
    dialysisFrequencyInput.focus();
    return false;
  }

  if (!diabeticInput.value) {
    showToast("Select diabetes mellitus status.");
    return false;
  }

  if (diabeticInput.value === "Yes" && !diabeticStageInput.value) {
    showToast("Select diabetes classification.");
    diabeticStageInput.focus();
    return false;
  }

  return true;
}

questionnaireHeightInput.addEventListener("input", updateQuestionnaireBmi);
questionnaireWeightInput.addEventListener("input", updateQuestionnaireBmi);
questionnaireContinueBtn.addEventListener("click", () => {
  if (!questionnaireForm.checkValidity()) {
    questionnaireForm.reportValidity();
    return;
  }

  if (!validateQuestionnaireForClinicalUpload()) {
    return;
  }

  egfrNav.disabled = false;
  activateTab("egfr");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

hospitalNameInput.addEventListener("change", updateHospitalId);
[studyIdInput, uhidInput, enrollmentDateInput, ageInput, sexInput, weightInput, ckdStageInput, diabeticInput].forEach((input) => {
  input.addEventListener("input", updateLinkedPatientSummary);
  input.addEventListener("change", updateLinkedPatientSummary);
});

enrollmentDateInput.addEventListener("change", updateConsentContext);

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
    document.querySelectorAll("input[name='dialysisChoice']").forEach((input) => {
      input.checked = false;
    });
  }

  updateLinkedPatientSummary();
}

function updateDiabeticVisibility() {
  const isDiabetic = diabeticInput.value === "Yes";
  diabeticStageBlock.classList.toggle("hidden", !isDiabetic);
  if (!isDiabetic) {
    diabeticStageInput.value = "";
  }
  updateLinkedPatientSummary();
}

ckdStageInput.addEventListener("change", updateDialysisVisibility);
diabeticInput.addEventListener("change", updateDiabeticVisibility);

function refreshDashboard() {
  updateDashboards();
  redrawRecentUploads();
}

async function loadBackendDashboard() {
  if (window.location.protocol === "file:") {
    return;
  }

  try {
    const response = await fetch("/api/dashboard-summary", { cache: "no-store" });
    const result = await response.json();
    if (response.ok && result.ok && result.dbConfigured && result.summary) {
      state.backendDashboard = result.summary;
      refreshDashboard();
    }
  } catch {
  }
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

  if (state.backendDashboard) {
    summaryHospitals = state.backendDashboard.summary?.hospitals || hospitals.length;
    summaryFindings = state.backendDashboard.summary?.patients || 0;
    summaryVideos = state.backendDashboard.summary?.videos || 0;
    stageCounts = { "1": 0, "2": 0, "3": 0, "4": 0 };
    (state.backendDashboard.stages || []).forEach((item) => {
      stageCounts[item.label] = item.value;
    });
    diabeticYes = (state.backendDashboard.diabetic || []).find((item) => item.label === "Yes")?.value || 0;
    diabeticNo = (state.backendDashboard.diabetic || []).find((item) => item.label === "No")?.value || 0;
    ageBuckets = buildAgeBuckets(dashboardItems);
  } else if (USE_DUMMY_DASHBOARD) {
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
  const studyId = studyIdInput.value.trim();
  const hospitalId = hospitalIdInput.value.trim();
  const hospitalName = selectedHospital?.name || "";
  const uhid = uhidInput.value.trim();
  const enrollmentDate = enrollmentDateInput.value;
  const siteCenter = siteCenterInput.value.trim();
  const consentObtained = getCheckedValue(consentObtainedInputs);
  const age = ageInput.value.trim();
  const sex = sexInput.value;
  const heightCm = heightInput.value.trim();
  const weight = weightInput.value.trim();
  const bmi = bmiInput.value.trim();
  const ethnicity = ethnicityInput.value.trim();
  const occupation = occupationInput.value.trim();
  const knownCkd = getCheckedValue(knownCkdInputs);
  const ckdDuration = ckdDurationInput.value.trim();
  const ckdStage = ckdStageInput.value;
  const dialysis = dialysisInput.value;
  const dialysisFrequency = dialysisFrequencyInput.value.trim();
  const diabetic = diabeticInput.value;
  const diabeticStage = diabeticStageInput.value.trim();
  const diabetesDuration = diabetesDurationInput.value.trim();
  const hypertension = getCheckedValue(hypertensionInputs);
  const hypertensionDuration = hypertensionDurationInput.value.trim();
  const cardiovascularDisease = getCheckedValue(cardiovascularDiseaseInputs);
  const familyKidneyHistory = getCheckedValue(familyKidneyHistoryInputs);
  const leftKidneyFile = leftKidneyFileInput.files[0];
  const rightKidneyFile = rightKidneyFileInput.files[0];
  const egfrReportFile = egfrReportInput.files[0];
  const patientPackageFile = patientPackageFileInput.files[0];
  const ultrasoundVideoFile = ultrasoundVideoFileInput.files[0];

  if (!hospitalName || !hospitalId || !uhid) {
    showToast("Hospital, Hospital ID, and UHID are required.");
    return null;
  }

  if (!validateQuestionnaireForClinicalUpload()) {
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
    hospitalSessionId: state.hospitalSession?.id || hospitalId,
    hospitalSessionName: state.hospitalSession?.name || hospitalName,
    studyId: studyId || "-",
    enrollmentDate: enrollmentDate || "-",
    siteCenter: siteCenter || "-",
    consentObtained: consentObtained || "-",
    uploadMode,
    uhid,
    age,
    sex,
    heightCm: heightCm || "-",
    weight,
    bmi: bmi || "-",
    ethnicity: ethnicity || "-",
    occupation: occupation || "-",
    knownCkd: knownCkd || "-",
    ckdDuration: ckdDuration || "-",
    ckdStage,
    dialysis: ckdStage === "3" || ckdStage === "4" ? dialysis : "-",
    dialysisFrequency: ckdStage === "3" || ckdStage === "4" && dialysis === "Yes" ? dialysisFrequency : "-",
    diabetic,
    diabeticStage: diabetic === "Yes" ? diabeticStage : "-",
    diabetesDuration: diabetesDuration || "-",
    hypertension: hypertension || "-",
    hypertensionDuration: hypertensionDuration || "-",
    cardiovascularDisease: cardiovascularDisease || "-",
    familyKidneyHistory: familyKidneyHistory || "-",
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
    ["Study ID", submission.studyId || "-"],
    ["Enrollment Date", submission.enrollmentDate || "-"],
    ["Consent Obtained", submission.consentObtained || "-"],
    ["Upload Method", submission.uploadMode === "package" ? "Single ZIP Package" : "Separate Files"],
    ["Age", submission.age],
    ["Sex", submission.sex],
    ["Height", submission.heightCm && submission.heightCm !== "-" ? `${submission.heightCm} cm` : "-"],
    ["Weight", `${submission.weight} kg`],
    ["BMI", submission.bmi || "-"],
    ["Known CKD", submission.knownCkd || "-"],
    ["CKD Stage", `Stage ${submission.ckdStage}`],
    ["Dialysis", submission.dialysis || "-"],
    ["Dialysis / Week", submission.dialysisFrequency || "-"],
    ["Diabetic", submission.diabetic],
    ["Diabetes Classification", submission.diabeticStage || "-"],
    ["Hypertension", submission.hypertension || "-"],
    ["Cardiovascular Disease", submission.cardiovascularDisease || "-"],
    ["Family Kidney History", submission.familyKidneyHistory || "-"]
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
  clearFilePreviews();
  updateUploadModeVisibility();
  updateDialysisVisibility();
  updateDiabeticVisibility();
  updateLinkedPatientSummary();
}

function resetPatientIntakeForNextRecord() {
  patientStartForm.reset();
  questionnaireForm.reset();
  landingEnrollmentDateInput.value = new Date().toISOString().slice(0, 10);
  hospitalNameInput.value = landingHospitalInput.value;
  hospitalIdInput.value = landingHospitalIdInput.value;
  consentCheckbox.checked = false;
  consentContinueBtn.disabled = true;
  consentNav.disabled = true;
  questionnaireNav.disabled = true;
  egfrNav.disabled = true;
  updateQuestionnaireBmi();
  updateConsentContext();
  updateLinkedPatientSummary();
  updateHospitalSessionUI();
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
    resetPatientIntakeForNextRecord();
    await loadBackendDashboard();
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
landingEnrollmentDateInput.value = new Date().toISOString().slice(0, 10);
updateLandingHospitalId();
loadHospitalSession();
updateConsentContext();
updateLinkedPatientSummary();
initializeGlobalValidation();
initializeFilePreviews();
updateUploadModeVisibility();
