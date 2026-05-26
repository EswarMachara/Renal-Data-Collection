const state = {
  pendingSubmission: null,
  recentUploads: [],
  uploadProgress: 0,
  hospitalSession: null,
  backendDashboard: null,
  authSession: null,   // { token, userId, hospitalId, hospitalName, role, expiresAt }
  studyFlow: "egfr",
  consentId: null,     // set after /api/consent succeeds
  questionnaireCompleted: false,
  currentUploadSession: null
};

const HOSPITAL_SESSION_KEY = "renalPortalHospitalSession";
const AUTH_SESSION_KEY     = "renalPortalAuthSession";
const STUDY_FLOW_KEY       = "renalPortalStudyFlow";
const RESUMABLE_UPLOAD_RETRIES = 3;

// Populated from /api/hospitals after login (or at startup when auth is disabled)
const hospitals = [];

// ─── Auth helpers ─────────────────────────────────────────────────────────────

const loginScreen   = document.getElementById("login-screen");
const appNavbar     = document.getElementById("app-navbar");
const loginForm     = document.getElementById("login-form");
const loginError    = document.getElementById("login-error");
const navbarAuth    = document.getElementById("navbar-auth");
const navbarUserLabel = document.getElementById("navbar-user-label");
const logoutBtn     = document.getElementById("logout-btn");

function normalizedStudyFlow(value) {
  return value === "kfre" ? "kfre" : "egfr";
}

function saveStudyFlow(value) {
  state.studyFlow = normalizedStudyFlow(value);
  try { sessionStorage.setItem(STUDY_FLOW_KEY, state.studyFlow); } catch { /* ignore */ }
}

function loadStudyFlow() {
  try {
    state.studyFlow = normalizedStudyFlow(sessionStorage.getItem(STUDY_FLOW_KEY));
  } catch {
    state.studyFlow = "egfr";
  }
  return state.studyFlow;
}

function authedFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.authSession?.token) {
    headers["Authorization"] = `Bearer ${state.authSession.token}`;
  }
  return fetch(url, { ...options, headers });
}

function loadAuthSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY) || "null");
    if (stored?.token) { state.authSession = stored; return true; }
  } catch { /* ignore */ }
  return false;
}

function saveAuthSession(sessionData) {
  state.authSession = sessionData;
  try { sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionData)); } catch { /* ignore */ }
}

function clearAuthSession() {
  state.authSession = null;
  state.hospitalSession = null;
  state.currentUploadSession = null;
  resetConsentRecord();
  try { sessionStorage.removeItem(AUTH_SESSION_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(HOSPITAL_SESSION_KEY); } catch { /* ignore */ }
}

function showLoginError(message) {
  if (!loginError) return;
  loginError.textContent = message;
  loginError.classList.remove("hidden");
}

function hideLoginError() {
  if (!loginError) return;
  loginError.classList.add("hidden");
  loginError.textContent = "";
}

function applyHospitalAuthContext() {
  const session = state.authSession;
  const sessionInstruction = document.getElementById("hospital-session-instruction");
  const saveSessionButton = document.getElementById("save-hospital-session");
  if (!session || session.role === "admin") {
    // Admin and unauthenticated: keep dropdown editable
    if (landingHospitalInput) landingHospitalInput.disabled = false;
    if (hospitalNameInput)    hospitalNameInput.disabled = false;
    if (sessionInstruction) sessionInstruction.textContent = "Choose once at the start of the day or browser session.";
    if (saveSessionButton) saveSessionButton.classList.remove("hidden");
    return;
  }

  // Hospital-role user: lock dropdown to their assigned hospital
  if (session.hospitalId) {
    const hospital = hospitals.find((entry) => entry.id === session.hospitalId);
    if (landingHospitalInput) {
      landingHospitalInput.value    = session.hospitalId;
      landingHospitalInput.disabled = true;
    }
    if (hospitalNameInput) {
      hospitalNameInput.value    = session.hospitalId;
      hospitalNameInput.disabled = true;
    }
    if (hospitalIdInput)  hospitalIdInput.value  = session.hospitalId;
    if (landingHospitalIdInput) landingHospitalIdInput.value = session.hospitalId;
    if (sessionInstruction) sessionInstruction.textContent = "Assigned automatically from your secure hospital account.";
    if (saveSessionButton) saveSessionButton.classList.add("hidden");

    // The authenticated hospital assignment is authoritative, even after account switches.
    // Fall back to hospitalName from auth session so patient fields unlock even if the hospitals
    // API call hasn't completed yet when this function runs.
    const hospitalName = hospital?.name || state.authSession.hospitalName || session.hospitalId;
    state.hospitalSession = { id: session.hospitalId, name: hospitalName };
    try { sessionStorage.setItem(HOSPITAL_SESSION_KEY, JSON.stringify(state.hospitalSession)); } catch { /* ignore */ }
    updateHospitalSessionUI();
  }
}

function showApp() {
  if (loginScreen)  loginScreen.classList.add("hidden");
  if (appNavbar)    appNavbar.classList.remove("hidden");
  document.querySelector(".app-container")?.classList.remove("hidden");

  const session = state.authSession;
  if (navbarUserLabel && session) {
    navbarUserLabel.textContent = session.role === "admin"
      ? "Admin"
      : (session.hospitalId || session.userId || "");
  }
  if (navbarAuth) navbarAuth.classList.remove("hidden");

  // Show submissions tab for all users; populate hospital filter for admin
  const submissionsNavBtn = document.getElementById("submissions-nav");
  if (submissionsNavBtn) submissionsNavBtn.style.display = "";
  populateSubHospitalFilter();
  updateWorkflowAccess();
}

function showLoginScreen() {
  if (loginScreen)  loginScreen.classList.remove("hidden");
  if (appNavbar)    appNavbar.classList.add("hidden");
  document.querySelector(".app-container")?.classList.add("hidden");
}

async function loadHospitalsFromApi() {
  try {
    const res    = await authedFetch("/api/hospitals");
    const result = await res.json();
    if (result.ok && Array.isArray(result.hospitals)) {
      hospitals.length = 0;
      result.hospitals.forEach((h) => hospitals.push(h));
      populateHospitals();
    }
  } catch { /* non-fatal; hospitals already populated from previous call */ }
}

// On any 401 from the server, clear session and show login
function handle401() {
  clearAuthSession();
  showLoginScreen();
  showToast("Your session has expired. Please sign in again.");
}

// ─── DOM references ───────────────────────────────────────────────────────────

const tabs = document.querySelectorAll(".nav-link[data-tab]");
const panels = {
  landing:     document.getElementById("tab-landing"),
  consent:     document.getElementById("tab-consent"),
  questionnaire: document.getElementById("tab-questionnaire"),
  egfr:        document.getElementById("tab-egfr"),
  dashboard:   document.getElementById("tab-dashboard"),
  submissions: document.getElementById("tab-submissions")
};

const egfrForm = document.getElementById("egfr-form");
const questionnaireForm = document.getElementById("questionnaire-form");
const recentBody = document.getElementById("recent-body");
const consentNav = document.getElementById("consent-nav");
const questionnaireNav = document.getElementById("questionnaire-nav");
const egfrNav = document.getElementById("egfr-nav");
const consentAccessBanner = document.getElementById("consent-access-banner");
const questionnaireAccessBanner = document.getElementById("questionnaire-access-banner");
const egfrAccessBanner = document.getElementById("egfr-access-banner");
const landingScrollSetupBtn = document.getElementById("landing-scroll-setup");
const hospitalSessionForm = document.getElementById("hospital-session-form");
const patientStartForm = document.getElementById("patient-start-form");
const intakeWorkspace = document.getElementById("intake-workspace");
const sessionWorkflow = document.getElementById("session-workflow");
const workflowContinueBtn = document.getElementById("workflow-continue");
const landingHospitalInput = document.getElementById("landing-hospital");
const landingHospitalIdInput = document.getElementById("landing-hospital-id");
const landingUhidInput = document.getElementById("landing-uhid");
const landingStudyIdInput = document.getElementById("landing-study-id");
const landingEnrollmentDateInput = document.getElementById("landing-enrollment-date");
const startPatientConsentBtn = document.getElementById("start-patient-consent");
const activeHospitalName = document.getElementById("active-hospital-name");
const activeHospitalId = document.getElementById("active-hospital-id");
const consentCheckbox = document.getElementById("consent-checkbox");
const kfreConsentCheckbox = document.getElementById("kfre-consent-checkbox");
const consentContinueBtn = document.getElementById("consent-continue");
const questionnaireContinueBtn = document.getElementById("questionnaire-continue");
const questionnaireHeightInput = document.getElementById("questionnaire-height");
const questionnaireWeightInput = document.getElementById("patient-weight");
const questionnaireBmiInput = document.getElementById("questionnaire-bmi");
const syncChoiceInputs = document.querySelectorAll("[data-sync-target]");
const consentFlowPanels = document.querySelectorAll("[data-consent-flow]");
const landingStudyEyebrow = document.getElementById("landing-study-eyebrow");
const landingStudyDescription = document.getElementById("landing-study-description");
const workflowRecordsTitle = document.getElementById("workflow-records-title");
const workflowRecordsSubtitle = document.getElementById("workflow-records-subtitle");
const consentPageMeta = document.getElementById("consent-page-meta");
const questionnairePageMeta = document.getElementById("questionnaire-page-meta");
const questionnaireStudyTitle = document.getElementById("questionnaire-study-title");
const questionnaireEgfrIec = document.getElementById("questionnaire-egfr-iec");
const questionnaireEgfrCtri = document.getElementById("questionnaire-egfr-ctri");
const questionnaireKfreIec = document.getElementById("questionnaire-kfre-iec");
const clinicalFlowNavLabel = document.getElementById("clinical-flow-nav-label");
const clinicalStepLabel = document.getElementById("clinical-step-label");
const clinicalPageTitle = document.getElementById("clinical-page-title");
const clinicalPageSubtitle = document.getElementById("clinical-page-subtitle");
const clinicalPageMeta = document.getElementById("clinical-page-meta");

function isConsentConfirmed() {
  return state.studyFlow === "kfre"
    ? Boolean(kfreConsentCheckbox.checked)
    : Boolean(consentCheckbox.checked);
}

function applyStudyFlowUI() {
  const isKfre = state.studyFlow === "kfre";
  consentFlowPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.consentFlow !== state.studyFlow);
  });
  landingStudyEyebrow.textContent = isKfre ? "Kidney Failure Risk Equation Study" : "AI-Based eGFR Research Registry";
  landingStudyDescription.textContent = isKfre
    ? "Collect consented kidney-related clinical reports for KFRE recalibration and validation in a guided workflow."
    : "Collect consented kidney ultrasound data, clinical reports, and questionnaire details in one guided workflow.";
  workflowRecordsTitle.textContent = isKfre ? "KFRE Clinical Record" : "eGFR Record Upload";
  workflowRecordsSubtitle.textContent = isKfre ? "Clinical data + report" : "Ultrasound + reports";
  consentPageMeta.textContent = isKfre
    ? "KFRE Study · Please verify the patient context before continuing"
    : "eGFR Study · Please verify the patient context before continuing";
  questionnairePageMeta.textContent = isKfre ? "KFRE Research Intake Questionnaire" : "eGFR Research Intake Questionnaire";
  questionnaireStudyTitle.textContent = isKfre
    ? "Recalibration and Validation of the Kidney Failure Risk Equation in an Indian Chronic Kidney Disease Cohort"
    : "AI-Based Multimodal Estimation of eGFR Using Kidney Ultrasound and Clinical Parameters";
  questionnaireEgfrIec.classList.toggle("hidden", isKfre);
  questionnaireEgfrCtri.classList.toggle("hidden", isKfre);
  questionnaireKfreIec.classList.toggle("hidden", !isKfre);
  clinicalFlowNavLabel.textContent = isKfre ? "KFRE Flow" : "eGFR Flow";
  clinicalStepLabel.textContent = isKfre ? "Document & Submit" : "Upload & Submit";
  clinicalPageTitle.textContent = isKfre ? "KFRE Clinical Record Collection" : "Clinical Data Collection";
  clinicalPageSubtitle.textContent = isKfre
    ? "Capture clinical assessment, follow-up outcomes, and the supporting document"
    : "Ultrasound findings and clinical record uploads";
  clinicalPageMeta.textContent = isKfre ? "KFRE Study · Clinical document only" : "eGFR Study · Ultrasound and clinical files";
  questionnaireContinueBtn.textContent = isKfre ? "Continue to KFRE Flow" : "Continue to eGFR Flow";
  updateStudySpecificUploadVisibility();
  updateWorkflowAccess();
}

function getWorkflowAccess() {
  const patientReady = Boolean(hospitalIdInput?.value.trim() && uhidInput?.value.trim());
  const consentReady = patientReady && Boolean(state.consentId);
  return {
    consent: patientReady,
    questionnaire: consentReady,
    egfr: consentReady && state.questionnaireCompleted
  };
}

const previewSnapshots = new WeakMap();

function capturePreviewValues(form) {
  form.querySelectorAll("input, select, textarea").forEach((control) => {
    previewSnapshots.set(control, { value: control.value, checked: control.checked });
  });
}

function restorePreviewValue(control) {
  const snapshot = previewSnapshots.get(control);
  if (!snapshot) return;
  control.value = snapshot.value;
  if (control.type === "checkbox" || control.type === "radio") {
    control.checked = snapshot.checked;
  }
}

function showPreviewLockedNotice(form) {
  const message = form === questionnaireForm
    ? "Complete and record e-consent to enter questionnaire details."
    : "Complete the questionnaire to enter clinical record details.";
  showToast(message);
}

function installPreviewGate(form) {
  if (!form || form.dataset.previewGateReady) return;
  form.dataset.previewGateReady = "true";
  form.addEventListener("click", (event) => {
    if (!form.classList.contains("preview-locked")) return;
    const control = event.target.closest("input, button");
    if (!control || control.matches("[data-tab-jump]")) return;
    if (control.matches("input[type='checkbox'], input[type='radio'], input[type='file'], button")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showPreviewLockedNotice(form);
    }
  }, true);
  ["input", "change"].forEach((eventName) => {
    form.addEventListener(eventName, (event) => {
      if (!form.classList.contains("preview-locked") || !event.target.matches("select")) return;
      restorePreviewValue(event.target);
      event.stopImmediatePropagation();
      if (eventName === "change") showPreviewLockedNotice(form);
    }, true);
  });
}

function setPreviewFormLocked(form, locked) {
  if (!form) return;
  installPreviewGate(form);
  form.classList.toggle("preview-locked", locked);
  form.setAttribute("aria-disabled", String(locked));
  form.querySelectorAll("input, select, textarea, button").forEach((control) => {
    if (control.matches("[data-tab-jump]")) return;
    if (locked) {
      if (!control.hasAttribute("data-gate-locked")) {
        control.dataset.gatePreviouslyDisabled = String(control.disabled);
        control.dataset.gatePreviouslyReadonly = String(Boolean(control.readOnly));
        control.setAttribute("data-gate-locked", "");
      }
      if (control.matches("button, input[type='file']")) {
        control.disabled = true;
      } else if (control.matches("input:not([type='checkbox']):not([type='radio']), textarea")) {
        control.readOnly = true;
      }
      return;
    }
    if (control.hasAttribute("data-gate-locked")) {
      control.disabled = control.dataset.gatePreviouslyDisabled === "true";
      if ("readOnly" in control) control.readOnly = control.dataset.gatePreviouslyReadonly === "true";
      delete control.dataset.gatePreviouslyDisabled;
      delete control.dataset.gatePreviouslyReadonly;
      control.removeAttribute("data-gate-locked");
    }
  });
  if (locked) capturePreviewValues(form);
}

function setWorkflowNavState(nav, banner, unlocked, title) {
  if (!nav) return;
  nav.disabled = false;
  nav.classList.toggle("is-locked", !unlocked);
  nav.title = unlocked ? title : `${title} — preview only until the previous step is completed`;
  banner?.classList.toggle("hidden", unlocked);
}

function updateWorkflowAccess() {
  const access = getWorkflowAccess();
  setWorkflowNavState(consentNav, consentAccessBanner, access.consent, "E-Consent Form");
  setWorkflowNavState(questionnaireNav, questionnaireAccessBanner, access.questionnaire, "Questionnaire");
  setWorkflowNavState(egfrNav, egfrAccessBanner, access.egfr, "eGFR Flow");

  document.getElementById("tab-consent")?.classList.toggle("preview-locked", !access.consent);
  [consentCheckbox, kfreConsentCheckbox].forEach((checkbox) => {
    checkbox.disabled = !access.consent || Boolean(state.consentId);
  });
  if (!access.consent || state.consentId) {
    consentContinueBtn.disabled = true;
  } else {
    consentContinueBtn.disabled = !isConsentConfirmed();
  }

  setPreviewFormLocked(questionnaireForm, !access.questionnaire);
  setPreviewFormLocked(egfrForm, !access.egfr);
  return access;
}

function initializeLandingReveal() {
  const revealSections = document.querySelectorAll("#tab-landing .reveal-section");
  if (!revealSections.length) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealSections.forEach((section) => section.classList.add("is-revealed"));
    return;
  }

  document.body.classList.add("reveal-enabled");
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-revealed");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.18, rootMargin: "0px 0px -8% 0px" });

  revealSections.forEach((section) => observer.observe(section));
}

function scrollToLandingSection(section) {
  if (!section) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  section.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
}

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
const ckdStageRemarksBlock = document.getElementById("ckd-stage-remarks-block");
const ckdStageRemarksInput = document.getElementById("ckd-stage-remarks");
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
const renalFindingsGrid = document.querySelector(".renal-findings-grid");
const leftKidneyCard = document.querySelector(".left-kidney-card");
const rightKidneyCard = document.querySelector(".right-kidney-card");
const kidneyMeasurementInputs = document.querySelectorAll(".renal-measurement-grid input[type='number']");
const leftKidneyFileInput = document.getElementById("left-kidney-file");
const rightKidneyFileInput = document.getElementById("right-kidney-file");
const egfrReportInput = document.getElementById("egfr-report");
const patientPackageFileInput = document.getElementById("patient-package-file");
const ultrasoundVideoFileInput = document.getElementById("ultrasound-video-file");
const kfreClinicalDocumentInput = document.getElementById("kfre-clinical-document");
const egfrUltrasoundSection = document.getElementById("egfr-ultrasound-section");
const egfrUploadMethodSection = document.getElementById("egfr-upload-method-section");
const egfrVideoSection = document.getElementById("egfr-video-section");
const kfreStructuredForm = document.getElementById("kfre-structured-form");
const kfreDocumentSection = document.getElementById("kfre-document-section");
const clinicalSubmitButton = document.getElementById("clinical-submit-button");
const kfreSystolicBpInput = document.getElementById("kfre-systolic-bp");
const kfreDiastolicBpInput = document.getElementById("kfre-diastolic-bp");
const kfreHeartRateInput = document.getElementById("kfre-heart-rate");
const kfreWaistHipRatioInput = document.getElementById("kfre-waist-hip-ratio");
const kfreFollowupStatusInput = document.getElementById("kfre-followup-status");
const kfreFollowupFields = document.getElementById("kfre-followup-fields");
const kfreFollowupVisitInput = document.getElementById("kfre-followup-visit");
const kfreFollowupMonthsInput = document.getElementById("kfre-followup-months");
const kfreRepeatCreatinineInput = document.getElementById("kfre-repeat-creatinine");
const kfreUpdatedEgfrInput = document.getElementById("kfre-updated-egfr");
const kfreCkdProgressionInput = document.getElementById("kfre-ckd-progression");
const kfreHospitalizationInput = document.getElementById("kfre-hospitalization");
const kfreDialysisInitiatedInput = document.getElementById("kfre-dialysis-initiated");
const kfreTransplantInput = document.getElementById("kfre-transplant");
const kfreOutcomeCkdStageInput = document.getElementById("kfre-outcome-ckd-stage");
const kfreRapidProgressionInput = document.getElementById("kfre-rapid-progression");
const kfreKidneyFailureEventInput = document.getElementById("kfre-kidney-failure-event");
const kfreKidneyFailureDetails = document.getElementById("kfre-kidney-failure-details");
const kfreKidneyFailureDateInput = document.getElementById("kfre-kidney-failure-date");
const kfreKidneyFailureTypeInput = document.getElementById("kfre-kidney-failure-type");
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
const consentRecordStatus = document.getElementById("consent-record-status");
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

if (renalFindingsGrid && leftKidneyCard && rightKidneyCard) {
  renalFindingsGrid.insertBefore(leftKidneyCard, rightKidneyCard);
}

const USE_DUMMY_DASHBOARD = false;
const dummyDashboard = {
  summary: { patients: 101, hospitals: 5, findings: 10 },
  stages: { Normal: 0, "1": 32, "2": 28, "3": 25, "4": 16, Other: 0 },
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

function setConsentRecordStatus(message, status = "pending") {
  if (!consentRecordStatus) return;
  consentRecordStatus.textContent = message;
  consentRecordStatus.classList.toggle("recorded", status === "recorded");
  consentRecordStatus.classList.toggle("error", status === "error");
}

function resetConsentRecord() {
  state.consentId = null;
  state.questionnaireCompleted = false;
  setConsentRecordStatus("Consent is not recorded yet.");
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

function formatCkdStage(value, remarks = "") {
  if (!value) return "--";
  if (value === "Normal") return "Normal";
  if (value === "Other") return remarks ? `Other — ${remarks}` : "Other";
  return `Stage ${value}`;
}

function getCkdStageClass(value) {
  return String(value || "other").toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function populateHospitals() {
  [landingHospitalInput, hospitalNameInput].forEach((select) => {
    // Clear all options except the first placeholder
    while (select.options.length > 1) select.remove(1);
    hospitals.forEach((hospital) => {
      const option = document.createElement("option");
      option.value = hospital.id;
      option.textContent = hospital.name;
      option.dataset.name = hospital.name;
      select.appendChild(option);
    });
  });
  // Re-apply hospital auth context so hospital users always see their pre-selected hospital
  // after the options are refreshed (clearing them resets the selected value).
  applyHospitalAuthContext();
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
  if (state.authSession?.role === "hospital" && state.authSession.hospitalId) {
    applyHospitalAuthContext();
    return;
  }

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

let globalValidationInitialized = false;
function initializeGlobalValidation() {
  if (globalValidationInitialized) return;
  globalValidationInitialized = true;
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
  linkedCkd.textContent = formatCkdStage(ckdStageInput.value, ckdStageRemarksInput.value.trim());
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

function computeDataQualityWarnings(record) {
  const warnings = [];
  const age = Number(record.age);
  const heightCm = record.heightCm === "-" ? null : Number(record.heightCm);
  const weightKg = record.weight === "-" ? null : Number(record.weight);
  const bmi = record.bmi === "-" ? null : Number(record.bmi);

  if (Number.isFinite(age) && age >= 90) warnings.push("Patient age is 90 years or above; verify age entry.");
  if (Number.isFinite(weightKg) && (weightKg < 30 || weightKg > 180)) warnings.push("Weight is outside the usual adult range; verify weight entry.");
  if (Number.isFinite(heightCm) && (heightCm < 120 || heightCm > 210)) warnings.push("Height is outside the usual adult range; verify height entry.");
  if (Number.isFinite(heightCm) && Number.isFinite(weightKg) && Number.isFinite(bmi)) {
    const calculatedBmi = weightKg / ((heightCm / 100) ** 2);
    if (Math.abs(calculatedBmi - bmi) > 1) warnings.push("BMI differs from height/weight calculation; verify BMI.");
    if (bmi < 16 || bmi > 40) warnings.push("BMI is outside the usual adult range; verify height and weight.");
  }
  if (["3a", "3b", "4", "5"].includes(record.ckdStage) && record.knownCkd === "No") {
    warnings.push("Advanced CKD stage selected while Known CKD is No; verify clinical history.");
  }
  if (record.diabetic === "No" && record.diabetesDuration !== "-") warnings.push("Diabetes duration is present while Diabetes Mellitus is No.");
  if (record.hypertension === "No" && record.hypertensionDuration !== "-") warnings.push("Hypertension duration is present while Hypertension is No.");
  return warnings;
}

function getUploadLabel(fieldName) {
  const labels = {
    leftKidney: "Left Kidney",
    rightKidney: "Right Kidney",
    egfrReport: "Clinical Report",
    patientPackage: "ZIP Package",
    ultrasoundVideo: "Ultrasound Video",
    clinicalDocument: "KFRE Clinical Document"
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
  const tile    = input.closest(".upload-tile");
  const preview = ensurePreview(input);
  const file    = input.files[0];

  preview.innerHTML = "";
  preview.classList.remove("has-file");
  tile.classList.remove("tile-has-file", "tile-loading");

  if (!file) {
    preview.textContent = "No file selected";
    return;
  }

  // Animate the tile bar, then settle into success state
  tile.classList.add("tile-loading");
  setTimeout(() => {
    tile.classList.remove("tile-loading");
    tile.classList.add("tile-has-file");
  }, 700);

  preview.classList.add("has-file");

  const details = document.createElement("div");
  details.className = "file-preview-details";
  details.innerHTML = `
    <strong>${escapeHTML(getUploadLabel(fieldName))}</strong>
    <span class="file-preview-name">
      <svg class="file-check-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="#14868c"/>
        <path d="M5 8.2l2.2 2.2L11 5.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      ${escapeHTML(file.name)}
    </span>
    <small>${escapeHTML(file.type || "Unknown type")} · ${formatBytes(file.size)}</small>
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
  showToast(`✓ ${file.name} attached and ready to upload`);
}

function clearFilePreviews() {
  document.querySelectorAll(".file-preview").forEach((preview) => {
    preview.classList.remove("has-file");
    preview.innerHTML = "No file selected";
  });
}

let filePreviewsInitialized = false;
function initializeFilePreviews() {
  if (filePreviewsInitialized) return;
  filePreviewsInitialized = true;
  [
    [leftKidneyFileInput, "leftKidney"],
    [rightKidneyFileInput, "rightKidney"],
    [egfrReportInput, "egfrReport"],
    [patientPackageFileInput, "patientPackage"],
    [ultrasoundVideoFileInput, "ultrasoundVideo"],
    [kfreClinicalDocumentInput, "clinicalDocument"]
  ].forEach(([input, fieldName]) => {
    renderFilePreview(input, fieldName);
    input.addEventListener("change", () => renderFilePreview(input, fieldName));
  });
}

function activateTab(tabKey) {
  updateWorkflowAccess();
  tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabKey;
    tab.classList.toggle("active", isActive);
  });

  Object.entries(panels).forEach(([key, panel]) => {
    panel?.classList.toggle("visible", key === tabKey);
  });

  if (tabKey === "dashboard")   loadBackendDashboard();
  if (tabKey === "submissions") loadSubmissions(1);

  updateStepper(tabKey);
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

// ─── Intake stepper + autosave ────────────────────────────────────────────────

const intakeStepper   = document.getElementById("intake-stepper");
const stpPatientChip  = document.getElementById("stp-patient-chip");
const stpAutosave     = document.getElementById("stp-autosave");
const draftToast      = document.getElementById("draft-toast");
const draftToastMsg   = document.getElementById("draft-toast-msg");
const draftToastClear = document.getElementById("draft-toast-clear");
const draftToastDismiss = document.getElementById("draft-toast-dismiss");

// Which nav-tab key maps to which step number
const TAB_TO_STEP = { landing: 1, consent: 2, questionnaire: 3, egfr: 4 };
function updateStepper(tabKey) {
  const currentStep = TAB_TO_STEP[tabKey];
  const isIntakeTab  = Boolean(currentStep);

  if (!intakeStepper) return;

  if (!isIntakeTab) {
    intakeStepper.classList.add("hidden");
    return;
  }

  intakeStepper.classList.remove("hidden");
  const access = getWorkflowAccess();
  const stepAccess = { 1: true, 2: access.consent, 3: access.questionnaire, 4: access.egfr };
  const completed = { 1: access.consent, 2: access.questionnaire, 3: access.egfr, 4: false };

  [1, 2, 3, 4].forEach((n) => {
    const el = document.getElementById(`stp-${n}`);
    if (!el) return;
    el.classList.remove("stp-active", "stp-done", "stp-pending", "stp-locked");
    if (n === currentStep) {
      el.classList.add("stp-active");
      el.classList.toggle("stp-locked", !stepAccess[n]);
    } else if (completed[n]) {
      el.classList.add("stp-done");
    } else {
      el.classList.add("stp-pending");
    }
  });

  // Fill the connector lines proportionally
  document.querySelectorAll(".stp-connector").forEach((conn, i) => {
    const filled = completed[i + 1];
    conn.classList.toggle("stp-connector-done", filled);
  });

  // Patient chip
  const h = state.hospitalSession;
  const uhid = uhidInput?.value.trim() || "";
  if (stpPatientChip) {
    stpPatientChip.textContent = (h && uhid)
      ? `${h.id}  ·  ${uhid}`
      : h ? h.id : "";
  }
}

// ── Autosave ──────────────────────────────────────────────────────────────────

function draftKey() {
  const hid  = state.hospitalSession?.id || "";
  const uhid = uhidInput?.value.trim() || "";
  return hid && uhid ? `tanuh_qdraft_${state.studyFlow}_${hid}_${uhid}` : null;
}

const DRAFT_FIELDS = [
  "study-id", "enrollment-date", "site-center",
  "patient-age", "questionnaire-height", "patient-weight",
  "ethnicity", "occupation", "ckd-stage", "ckd-stage-remarks", "ckd-duration",
  "dialysis-frequency", "diabetes-duration", "diabetic-stage",
  "hypertension-duration"
];
const DRAFT_RADIOS = [
  "consentObtained", "questionnaireSex", "knownCkd",
  "dialysisChoice", "diabetesMellitus", "hypertension",
  "cardiovascularDisease", "familyKidneyHistory"
];

function serializeDraft() {
  const data = {};
  DRAFT_FIELDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  DRAFT_RADIOS.forEach((name) => {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    if (checked) data[`radio_${name}`] = checked.value;
  });
  return data;
}

function restoreDraft(saved) {
  DRAFT_FIELDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el && saved[id] !== undefined) el.value = saved[id];
  });
  DRAFT_RADIOS.forEach((name) => {
    const val = saved[`radio_${name}`];
    if (!val) return;
    const radio = document.querySelector(`input[name="${name}"][value="${val}"]`);
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  // Recalculate derived fields
  updateQuestionnaireBmi?.();
  updateDialysisVisibility?.();
  updateDiabeticVisibility?.();
}

function clearDraft() {
  const key = draftKey();
  if (key) try { localStorage.removeItem(key); } catch { /* ignore */ }
}

let _autosaveTimer = null;
function scheduleSave() {
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    const key = draftKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({ ...serializeDraft(), _savedAt: new Date().toISOString() }));
    } catch { /* storage full — ignore */ }
    if (stpAutosave) {
      stpAutosave.textContent = "Draft saved " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      stpAutosave.classList.add("stp-autosave-flash");
      setTimeout(() => stpAutosave.classList.remove("stp-autosave-flash"), 1800);
    }
  }, 700);
}

function checkAndRestoreDraft() {
  const key = draftKey();
  if (!key) return;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch { return; }
  if (!saved) return;

  restoreDraft(saved);

  const t = saved._savedAt ? new Date(saved._savedAt) : null;
  const timeStr = t ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  if (draftToastMsg) draftToastMsg.textContent = `Draft restored${timeStr ? " — last saved " + timeStr : ""}`;
  if (draftToast) {
    draftToast.classList.remove("hidden");
    clearTimeout(draftToast._dismiss);
    draftToast._dismiss = setTimeout(() => draftToast.classList.add("hidden"), 6000);
  }
}

// Wire autosave listeners on questionnaire form
document.getElementById("questionnaire-form")?.addEventListener("input", scheduleSave);
document.getElementById("questionnaire-form")?.addEventListener("change", scheduleSave);

draftToastDismiss?.addEventListener("click", () => draftToast.classList.add("hidden"));
draftToastClear?.addEventListener("click", () => {
  clearDraft();
  draftToast.classList.add("hidden");
  document.getElementById("questionnaire-form")?.reset();
  updateQuestionnaireBmi?.();
  updateDialysisVisibility?.();
  updateDiabeticVisibility?.();
});

// Hook into questionnaire tab activation to restore draft
const _origActivateTab = activateTab;
// (patch already applied via the if-block in activateTab; restore happens here via tab-switch event)
document.querySelectorAll("[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.tab === "questionnaire") checkAndRestoreDraft();
  });
});
document.querySelectorAll("[data-tab-jump]").forEach((btn) => {
  if (btn.dataset.tabJump === "questionnaire") {
    btn.addEventListener("click", checkAndRestoreDraft);
  }
});

consentCheckbox.addEventListener("change", () => {
  if (!state.consentId && getWorkflowAccess().consent) {
    consentContinueBtn.textContent = "Accept & Continue";
    consentContinueBtn.disabled = !isConsentConfirmed();
  }
});
kfreConsentCheckbox.addEventListener("change", () => {
  if (!state.consentId && getWorkflowAccess().consent) {
    consentContinueBtn.textContent = "Accept & Continue";
    consentContinueBtn.disabled = !isConsentConfirmed();
  }
});

landingScrollSetupBtn.addEventListener("click", () => {
  scrollToLandingSection(sessionWorkflow || intakeWorkspace);
});

workflowContinueBtn?.addEventListener("click", () => {
  scrollToLandingSection(intakeWorkspace);
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
  resetConsentRecord();
  state.currentUploadSession = null;
  try {
    sessionStorage.removeItem(HOSPITAL_SESSION_KEY);
  } catch {
  }
  updateHospitalSessionUI();
  updateConsentContext();
  updateLinkedPatientSummary();
  updateWorkflowAccess();
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
  resetConsentRecord();
  state.currentUploadSession = null;
  consentCheckbox.checked = false;
  kfreConsentCheckbox.checked = false;
  consentContinueBtn.disabled = true;
  updateWorkflowAccess();
  activateTab("consent");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

consentContinueBtn.addEventListener("click", async () => {
  if (!hospitalIdInput.value || !uhidInput.value.trim()) {
    showToast("Create the patient intake before accepting consent.");
    activateTab("landing");
    return;
  }

  consentContinueBtn.disabled = true;
  consentContinueBtn.textContent = "Recording Consent...";
  setConsentRecordStatus("Recording consent...");

  try {
    const response = await authedFetch("/api/consent", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ uhid: uhidInput.value.trim(), hospitalId: hospitalIdInput.value, studyFlow: state.studyFlow })
    });
    if (response.status === 401) { handle401(); return; }
    const result = await response.json();
    if (!response.ok || !result.ok || !result.consentId) {
      throw new Error(result.error || "Could not record consent.");
    }
    state.consentId = result.consentId;
    setConsentRecordStatus(`Consent recorded: ${result.consentId}`, "recorded");
  } catch (err) {
    resetConsentRecord();
    setConsentRecordStatus("Consent recording failed. Please retry.", "error");
    showToast(err.message || "Consent recording failed. Please retry.");
    consentContinueBtn.textContent = "Accept & Continue";
    consentContinueBtn.disabled = !isConsentConfirmed();
    return;
  }

  consentContinueBtn.textContent = "Consent Recorded";
  updateWorkflowAccess();
  activateTab("questionnaire");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

function updateQuestionnaireBmi() {
  const heightCm = Number(questionnaireHeightInput.value);
  const weightKg = Number(questionnaireWeightInput.value);
  if (!heightCm || !weightKg || heightCm < 50 || heightCm > 250 || weightKg < 10 || weightKg > 400) {
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
    showToast("Enter patient age between 18 and 120 years.");
    ageInput.focus();
    return false;
  }

  if (!sexInput.value) {
    showToast("Select patient sex.");
    return false;
  }

  if (!heightInput.value.trim() || Number(heightInput.value) < 50 || Number(heightInput.value) > 250) {
    showToast("Enter measured height between 50 and 250 cm.");
    heightInput.focus();
    return false;
  }

  if (!weightInput.value.trim() || Number(weightInput.value) < 10 || Number(weightInput.value) > 400) {
    showToast("Enter measured weight between 10 and 400 kg.");
    weightInput.focus();
    return false;
  }

  const calculatedBmi = Number(bmiInput.value);
  if (!Number.isFinite(calculatedBmi) || calculatedBmi < 5 || calculatedBmi > 100) {
    showToast("Height and weight produce an implausible BMI; verify both measurements.");
    heightInput.focus();
    return false;
  }

  if (!ckdStageInput.value) {
    showToast("Select CKD stage.");
    ckdStageInput.focus();
    return false;
  }

  if (ckdStageInput.value === "Other" && !ckdStageRemarksInput.value.trim()) {
    showToast("Enter remarks for Other CKD stage.");
    ckdStageRemarksInput.focus();
    return false;
  }

  if (["3a", "3b", "4", "5"].includes(ckdStageInput.value) && !dialysisInput.value) {
    showToast("Select dialysis status for CKD stage 3a, 3b, 4, or 5.");
    return false;
  }

  if (["3a", "3b", "4", "5"].includes(ckdStageInput.value) && dialysisInput.value === "Yes" && !dialysisFrequencyInput.value.trim()) {
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

  state.questionnaireCompleted = true;
  updateWorkflowAccess();
  activateTab("egfr");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

hospitalNameInput.addEventListener("change", updateHospitalId);
[studyIdInput, uhidInput, enrollmentDateInput, ageInput, sexInput, weightInput, ckdStageInput, ckdStageRemarksInput, diabeticInput].forEach((input) => {
  input.addEventListener("input", updateLinkedPatientSummary);
  input.addEventListener("change", updateLinkedPatientSummary);
});

enrollmentDateInput.addEventListener("change", updateConsentContext);

function getUploadMode() {
  if (state.studyFlow === "kfre") {
    return "clinical_document";
  }
  return document.querySelector("input[name='uploadMode']:checked")?.value || "separate";
}

function updateStudySpecificUploadVisibility() {
  const isKfre = state.studyFlow === "kfre";
  [egfrUltrasoundSection, egfrUploadMethodSection, separateUploadSection, packageUploadSection, egfrVideoSection]
    .forEach((section) => section?.classList.toggle("hidden", isKfre));
  kfreStructuredForm?.classList.toggle("hidden", !isKfre);
  kfreDocumentSection?.classList.toggle("hidden", !isKfre);
  kfreClinicalDocumentInput.required = isKfre;
  clinicalSubmitButton.textContent = isKfre ? "Submit KFRE Record" : "Submit eGFR Record";
  updateKfreConditionalFields();

  if (isKfre) {
    [leftKidneyFileInput, rightKidneyFileInput, egfrReportInput, patientPackageFileInput, ultrasoundVideoFileInput]
      .forEach((input) => { input.required = false; });
  } else {
    kfreClinicalDocumentInput.value = "";
    renderFilePreview(kfreClinicalDocumentInput, "clinicalDocument");
    updateUploadModeVisibility();
  }
}

function clearControlsInPanel(panel) {
  panel?.querySelectorAll("input, select").forEach((input) => {
    input.value = "";
  });
}

function updateKfreConditionalFields({ clearHidden = false } = {}) {
  const isKfre = state.studyFlow === "kfre";
  const followupAvailable = isKfre && kfreFollowupStatusInput.value === "Available";
  const kidneyFailureRecorded = isKfre && kfreKidneyFailureEventInput.value === "Yes";
  const alwaysRequired = [
    kfreSystolicBpInput, kfreDiastolicBpInput, kfreHeartRateInput, kfreWaistHipRatioInput,
    kfreOutcomeCkdStageInput, kfreRapidProgressionInput, kfreKidneyFailureEventInput
  ];
  const followupRequired = [
    kfreFollowupVisitInput, kfreFollowupMonthsInput, kfreRepeatCreatinineInput, kfreUpdatedEgfrInput,
    kfreCkdProgressionInput, kfreHospitalizationInput, kfreDialysisInitiatedInput, kfreTransplantInput
  ];

  alwaysRequired.forEach((input) => { input.required = isKfre; });
  followupRequired.forEach((input) => { input.required = followupAvailable; });
  kfreKidneyFailureDateInput.required = kidneyFailureRecorded;
  kfreKidneyFailureTypeInput.required = kidneyFailureRecorded;
  kfreFollowupFields.classList.toggle("hidden", !followupAvailable);
  kfreKidneyFailureDetails.classList.toggle("hidden", !kidneyFailureRecorded);

  if (clearHidden && !followupAvailable) clearControlsInPanel(kfreFollowupFields);
  if (clearHidden && !kidneyFailureRecorded) clearControlsInPanel(kfreKidneyFailureDetails);
}

function updateUploadModeVisibility() {
  if (state.studyFlow === "kfre") {
    return;
  }
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
kfreFollowupStatusInput.addEventListener("change", () => updateKfreConditionalFields({ clearHidden: true }));
kfreKidneyFailureEventInput.addEventListener("change", () => updateKfreConditionalFields({ clearHidden: true }));
kfreKidneyFailureDateInput.addEventListener("change", () => validateDateInput(kfreKidneyFailureDateInput));

function updateDialysisVisibility() {
  const stage = ckdStageInput.value;
  const shouldShow = ["3a", "3b", "4", "5"].includes(stage);
  const shouldShowRemarks = stage === "Other";
  dialysisBlock.classList.toggle("hidden", !shouldShow);
  ckdStageRemarksBlock.classList.toggle("hidden", !shouldShowRemarks);
  ckdStageRemarksInput.required = shouldShowRemarks;

  if (!shouldShow) {
    dialysisInput.value = "";
    dialysisFrequencyInput.value = "";
    document.querySelectorAll("input[name='dialysisChoice']").forEach((input) => {
      input.checked = false;
    });
  }

  if (!shouldShowRemarks) {
    ckdStageRemarksInput.value = "";
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

const CKD_DONUT_SEGMENTS = (counts) => [
  { label: "Normal",   value: counts["Normal"] || 0, color: "#0f9a87" },
  { label: "Stage 1",  value: counts["1"]      || 0, color: "#2dd4bf" },
  { label: "Stage 2",  value: counts["2"]      || 0, color: "#60a5fa" },
  { label: "Stage 3a", value: counts["3a"]     || 0, color: "#fbbf24" },
  { label: "Stage 3b", value: counts["3b"]     || 0, color: "#f97316" },
  { label: "Stage 4",  value: counts["4"]      || 0, color: "#f87171" },
  { label: "Stage 5",  value: counts["5"]      || 0, color: "#dc2626" },
  { label: "Other",    value: counts["Other"]  || 0, color: "#8b5cf6" }
];

function updateDashboards() {
  const d    = state.backendDashboard;
  const role = state.authSession?.role;

  // Show the correct view panel
  const adminView  = document.getElementById("dash-admin-view");
  const hospView   = document.getElementById("dash-hospital-view");
  if (adminView)  adminView.classList.toggle("hidden",  role !== "admin");
  if (hospView)   hospView.classList.toggle("hidden",   role === "admin");

  if (!d) return;

  const nowStr = `Last updated: ${new Date().toLocaleTimeString()}`;

  if (role === "admin") {
    // ── Admin summary cards ───────────────────────────────────────────────
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("summary-hospitals", d.summary?.hospitals ?? 0);
    set("summary-findings",  d.summary?.patients  ?? 0);
    set("summary-videos",    d.summary?.videos    ?? 0);
    set("summary-pending",   d.summary?.pending   ?? 0);
    const updEl = document.getElementById("dashboard-updated-at");
    if (updEl) updEl.textContent = nowStr;

    // ── Per-hospital breakdown ────────────────────────────────────────────
    renderHospitalBreakdown(d.hospitalBreakdown || [], d.summary?.patients || 0);

    // ── Charts ───────────────────────────────────────────────────────────
    const stageCounts = {};
    (d.stages || []).forEach((s) => { stageCounts[s.label] = s.value; });
    const total = d.summary?.patients || 0;
    renderDonut("ckd-stage-donut", "ckd-stage-center", "ckd-stage-legend",
      CKD_DONUT_SEGMENTS(stageCounts), String(total));

    const ageBuckets = (d.ageBuckets || []).map((b) => ({ label: b.bucket, value: b.count }));
    renderHistogram("age-histogram", ageBuckets);

    const diabYes = (d.diabetic || []).find((x) => x.label === "Yes")?.value || 0;
    const diabNo  = (d.diabetic || []).find((x) => x.label === "No")?.value  || 0;
    renderDonut("diabetic-donut", "diabetic-center", "diabetic-legend", [
      { label: "CKD Diabetic",     value: diabYes, color: "#0f9a87" },
      { label: "CKD Non-Diabetic", value: diabNo,  color: "#94a3b8" }
    ]);

    // ── Recent records table ──────────────────────────────────────────────
    renderRecentRecordsTable("recent-body", d.recentRecords || [], ["uhid","hospitalId","uploadMode","receivedAt","reviewedAt"]);

  } else {
    // ── Hospital summary cards ────────────────────────────────────────────
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("hosp-summary-patients", d.summary?.patients  ?? 0);
    set("hosp-summary-videos",   d.summary?.videos    ?? 0);
    set("hosp-summary-pending",  d.summary?.pending   ?? 0);

    const subtitleEl = document.getElementById("dash-hospital-subtitle");
    const hospName = state.authSession?.hospitalName || state.authSession?.hospitalId || "";
    if (subtitleEl && hospName) subtitleEl.textContent = `Submitted patient records and review progress for ${hospName}`;

    const updEl = document.getElementById("dash-hospital-updated");
    if (updEl) updEl.textContent = nowStr;

    // ── Charts ───────────────────────────────────────────────────────────
    const stageCounts = {};
    (d.stages || []).forEach((s) => { stageCounts[s.label] = s.value; });
    const total = d.summary?.patients || 0;
    renderDonut("hosp-ckd-donut", "hosp-ckd-center", "hosp-ckd-legend",
      CKD_DONUT_SEGMENTS(stageCounts), String(total));

    const ageBuckets = (d.ageBuckets || []).map((b) => ({ label: b.bucket, value: b.count }));
    renderHistogram("hosp-age-histogram", ageBuckets);

    // ── Recent records table ──────────────────────────────────────────────
    renderRecentRecordsTable("hosp-recent-body", d.recentRecords || [], ["uhid","uploadMode","receivedAt","reviewedAt"]);
  }
}

function renderHospitalBreakdown(breakdown, grandTotal) {
  const grid = document.getElementById("hosp-breakdown-grid");
  const note = document.getElementById("hosp-breakdown-note");
  if (!grid) return;

  const maxPatients = Math.max(...breakdown.map((h) => h.patients), 1);
  const totalWithData = breakdown.filter((h) => h.patients > 0).length;
  if (note) note.textContent = `${totalWithData} of ${breakdown.length} hospitals have submitted records`;

  if (!breakdown.length) {
    grid.innerHTML = '<p class="empty">No data yet.</p>';
    return;
  }

  grid.innerHTML = breakdown.map((h) => {
    const pct      = grandTotal > 0 ? Math.round((h.patients / grandTotal) * 100) : 0;
    const barWidth = Math.round((h.patients / maxPatients) * 100);
    const reviewed = h.patients > 0 ? Math.round((h.reviewed / h.patients) * 100) : 0;
    return `
      <div class="hosp-breakdown-card ${h.patients === 0 ? "hosp-card-empty" : ""}">
        <div class="hosp-card-header">
          <div>
            <span class="hosp-card-id">${escapeHTML(h.hospitalId)}</span>
            <span class="hosp-card-name">${escapeHTML(h.hospitalName)}</span>
          </div>
          <span class="hosp-card-count">${h.patients} record${h.patients !== 1 ? "s" : ""}</span>
        </div>
        <div class="hosp-bar-track">
          <div class="hosp-bar-fill" style="width:${barWidth}%"></div>
        </div>
        <div class="hosp-card-meta">
          <span class="hosp-meta-chip hosp-meta-pct">${pct}% of total</span>
          ${h.videos > 0 ? `<span class="hosp-meta-chip hosp-meta-video">${h.videos} video${h.videos !== 1 ? "s" : ""}</span>` : ""}
          <span class="hosp-meta-chip hosp-meta-review">${h.reviewed}/${h.patients} reviewed (${reviewed}%)</span>
        </div>
      </div>`;
  }).join("");
}

function renderRecentRecordsTable(tbodyId, records, cols) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  if (!records.length) {
    const colCount = cols.length;
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty">No records yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = records.map((r) => {
    const cells = cols.map((c) => {
      if (c === "receivedAt") return `<td class="sub-date">${subFormatDate(r.receivedAt)}</td>`;
      if (c === "reviewedAt") return r.reviewedAt
        ? `<td><span class="sub-badge sub-badge-reviewed">Reviewed</span></td>`
        : `<td><span class="sub-badge sub-badge-pending">Awaiting Review</span></td>`;
      if (c === "uploadMode") return `<td>${escapeHTML(subUploadMode(r.uploadMode))}</td>`;
      return `<td>${escapeHTML(String(r[c] || "—"))}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
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

function buildSubmissionPayload(timestamp, submission) {
  const submissions = [submission].map((item) => {
    const { uploadFiles, ...metadata } = item;
    return {
      ...metadata,
      files: uploadFiles.map((upload) => ({
        fieldName: upload.fieldName,
        name: upload.file.name,
        type: upload.file.type || "application/octet-stream",
        size: upload.file.size
      }))
    };
  });

  return { timestamp, submissions };
}

function buildSubmissionFormData(timestamp, submission) {
  const formData = new FormData();
  const payload = buildSubmissionPayload(timestamp, submission);
  [submission].forEach((item, index) => {
    item.uploadFiles.forEach((upload) => {
      formData.append(`file_${index}_${upload.fieldName}`, upload.file, upload.file.name);
    });
  });

  formData.append("payload", JSON.stringify(payload));
  return formData;
}

async function parseUploadJson(response) {
  let result = {};
  try {
    result = await response.json();
  } catch {
    throw new Error("Server returned an unreadable response.");
  }
  if (response.status === 401) {
    handle401();
    throw new Error("Session expired. Please sign in again.");
  }
  if (!response.ok || !result.ok) {
    throw new Error(result.error || "Upload failed.");
  }
  return result;
}

async function createResumableUpload(timestamp, submission) {
  const payload = buildSubmissionPayload(timestamp, submission);
  const response = await authedFetch("/api/uploads/init", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ timestamp, submission: payload.submissions[0] })
  });
  return parseUploadJson(response);
}

async function uploadChunkWithRetry({ uploadId, fileIndex, chunkIndex, chunk }) {
  let lastError = null;
  for (let attempt = 1; attempt <= RESUMABLE_UPLOAD_RETRIES; attempt += 1) {
    try {
      const response = await authedFetch(`/api/uploads/${uploadId}/files/${fileIndex}/chunks/${chunkIndex}`, {
        method: "PUT",
        body:   chunk
      });
      return await parseUploadJson(response);
    } catch (err) {
      lastError = err;
      if (attempt < RESUMABLE_UPLOAD_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 900));
      }
    }
  }
  throw lastError || new Error("Chunk upload failed.");
}

async function completeResumableUpload(uploadId) {
  const response = await authedFetch(`/api/uploads/${uploadId}/complete`, { method: "POST" });
  return parseUploadJson(response);
}

async function getResumableUploadStatus(uploadId) {
  const response = await authedFetch(`/api/uploads/${uploadId}/status`);
  return parseUploadJson(response);
}

function getSubmissionUploadSignature(submission) {
  const { uploadFiles, progress, status, reviewedAt, ...metadata } = submission;
  return [
    JSON.stringify(metadata),
    ...submission.uploadFiles.map((upload) => `${upload.fieldName}:${upload.file.name}:${upload.file.size}`)
  ].join("|");
}

function clearCurrentUploadSession() {
  state.currentUploadSession = null;
}

async function sendResumableSubmission(timestamp, submission) {
  const signature = getSubmissionUploadSignature(submission);
  let session = state.currentUploadSession?.signature === signature ? state.currentUploadSession : null;
  if (!session) {
    session = await createResumableUpload(timestamp, submission);
    state.currentUploadSession = {
      uploadId: session.uploadId,
      chunkSize: Number(session.chunkSize || 5 * 1024 * 1024),
      signature
    };
  } else {
    setUploadProgress(state.uploadProgress || 0, "Checking resumable upload status");
    try {
      const status = await getResumableUploadStatus(session.uploadId);
      session = { ...session, ...status };
    } catch {
      clearCurrentUploadSession();
      session = await createResumableUpload(timestamp, submission);
      state.currentUploadSession = {
        uploadId: session.uploadId,
        chunkSize: Number(session.chunkSize || 5 * 1024 * 1024),
        signature
      };
    }
  }

  const chunkSize = Number(session.chunkSize || state.currentUploadSession?.chunkSize || 5 * 1024 * 1024);
  const receivedByFile = new Map();
  if (Array.isArray(session.files)) {
    session.files.forEach((file) => {
      receivedByFile.set(file.index, new Set(file.receivedChunks || []));
    });
  }
  const totalBytes = Math.max(1, submission.uploadFiles.reduce((sum, upload) => sum + upload.file.size, 0));
  let uploadedBytes = Array.isArray(session.files)
    ? session.files.reduce((sum, file) => sum + Number(file.receivedBytes || 0), 0)
    : 0;

  for (let fileIndex = 0; fileIndex < submission.uploadFiles.length; fileIndex += 1) {
    const upload = submission.uploadFiles[fileIndex];
    const file = upload.file;
    const totalChunks = Math.ceil(file.size / chunkSize);
    const receivedChunks = receivedByFile.get(fileIndex) || new Set();

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);
      if (receivedChunks.has(chunkIndex)) {
        continue;
      }
      setUploadProgress(
        (uploadedBytes / totalBytes) * 100,
        `Uploading ${getUploadLabel(upload.fieldName)} (${chunkIndex + 1}/${totalChunks})`
      );
      await uploadChunkWithRetry({ uploadId: state.currentUploadSession.uploadId, fileIndex, chunkIndex, chunk });
      uploadedBytes += chunk.size;
      setUploadProgress((uploadedBytes / totalBytes) * 96, `Uploaded ${getUploadLabel(upload.fieldName)}`);
    }
  }

  setUploadProgress(98, "Finalizing record and syncing cloud storage");
  const result = await completeResumableUpload(state.currentUploadSession.uploadId);
  clearCurrentUploadSession();
  return result;
}

function sendSubmission(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/submissions");
    if (state.authSession?.token) {
      xhr.setRequestHeader("Authorization", `Bearer ${state.authSession.token}`);
    }

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

function getFormTextValue(id) {
  return document.getElementById(id)?.value.trim() || "-";
}

function getSelectedChoiceValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "-";
}

function collectKidneyFindings(side) {
  return {
    lengthCm: getFormTextValue(`${side}-kidney-length`),
    widthCm: getFormTextValue(`${side}-kidney-width`),
    corticalThicknessMm: getFormTextValue(`${side}-cortical-thickness`),
    echogenicity: getSelectedChoiceValue(`${side}Echogenicity`),
    structural: {
      kidneySize: getSelectedChoiceValue(`${side}KidneySize`),
      parenchymalTexture: getSelectedChoiceValue(`${side}ParenchymalTexture`),
      cysts: getSelectedChoiceValue(`${side}Cysts`),
      stones: getSelectedChoiceValue(`${side}Stones`),
      hydronephrosis: getSelectedChoiceValue(`${side}Hydronephrosis`),
      others: getFormTextValue(`${side}-other-findings`)
    }
  };
}

function formatClinicalMeasurement(value, unit) {
  return value && value !== "-" ? `${value} ${unit}` : "-";
}

function getKidneyFindingReviewRows(label, findings) {
  const structural = findings?.structural || {};
  return [
    [`${label} Length`, formatClinicalMeasurement(findings?.lengthCm, "cm")],
    [`${label} Width`, formatClinicalMeasurement(findings?.widthCm, "cm")],
    [`${label} Cortical Thickness`, formatClinicalMeasurement(findings?.corticalThicknessMm, "mm")],
    [`${label} Echogenicity`, findings?.echogenicity || "-"],
    [`${label} Size`, structural.kidneySize || "-"],
    [`${label} Parenchymal Texture`, structural.parenchymalTexture || "-"],
    [`${label} Cysts`, structural.cysts || "-"],
    [`${label} Stones`, structural.stones || "-"],
    [`${label} Hydronephrosis`, structural.hydronephrosis || "-"],
    [`${label} Other Findings`, structural.others || "-"]
  ];
}

function collectKfreForm() {
  const hasFollowup = kfreFollowupStatusInput.value === "Available";
  const hasKidneyFailureEvent = kfreKidneyFailureEventInput.value === "Yes";
  return {
    clinicalExamination: {
      systolicBp: kfreSystolicBpInput.value.trim(),
      diastolicBp: kfreDiastolicBpInput.value.trim(),
      heartRate: kfreHeartRateInput.value.trim(),
      waistHipRatio: kfreWaistHipRatioInput.value.trim()
    },
    followUp: hasFollowup ? {
      visit: kfreFollowupVisitInput.value,
      months: kfreFollowupMonthsInput.value.trim(),
      repeatCreatinine: kfreRepeatCreatinineInput.value.trim(),
      updatedEgfr: kfreUpdatedEgfrInput.value.trim(),
      ckdProgression: kfreCkdProgressionInput.value,
      hospitalization: kfreHospitalizationInput.value,
      dialysisInitiated: kfreDialysisInitiatedInput.value,
      transplant: kfreTransplantInput.value
    } : null,
    outcomes: {
      ckdStage: kfreOutcomeCkdStageInput.value,
      rapidProgression: kfreRapidProgressionInput.value,
      kidneyFailureEvent: kfreKidneyFailureEventInput.value,
      eventDate: hasKidneyFailureEvent ? kfreKidneyFailureDateInput.value : "-",
      eventType: hasKidneyFailureEvent ? kfreKidneyFailureTypeInput.value : "-"
    }
  };
}

function getKfreReviewRows(kfreForm) {
  if (!kfreForm) return [];
  const examination = kfreForm.clinicalExamination || {};
  const followUp = kfreForm.followUp;
  const outcomes = kfreForm.outcomes || {};
  const rows = [
    ["Blood Pressure", `${examination.systolicBp}/${examination.diastolicBp} mmHg`],
    ["Heart Rate", `${examination.heartRate} bpm`],
    ["Waist-to-Hip Ratio", examination.waistHipRatio],
    ["Follow-up", followUp ? `${followUp.visit} · ${followUp.months} months` : "None"],
    ["Outcome CKD Stage", formatCkdStage(outcomes.ckdStage)],
    ["Rapid Progression", outcomes.rapidProgression],
    ["Kidney Failure Event", outcomes.kidneyFailureEvent]
  ];
  if (followUp) {
    rows.push(
      ["Repeat Creatinine", `${followUp.repeatCreatinine} mg/dL`],
      ["Updated eGFR", `${followUp.updatedEgfr} mL/min/1.73 m²`],
      ["CKD Progression", followUp.ckdProgression],
      ["Hospitalization", followUp.hospitalization],
      ["Dialysis Initiated", followUp.dialysisInitiated],
      ["Transplant", followUp.transplant]
    );
  }
  if (outcomes.kidneyFailureEvent === "Yes") {
    rows.push(["Failure Event Date", outcomes.eventDate], ["Failure Event Type", outcomes.eventType]);
  }
  return rows;
}

function buildSubmissionFromForm() {
  const selectedHospital = hospitals.find((hospital) => hospital.id === hospitalNameInput.value);
  const isKfre = state.studyFlow === "kfre";
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
  const ckdStageRemarks = ckdStageRemarksInput.value.trim();
  const dialysis = dialysisInput.value;
  const dialysisFrequency = dialysisFrequencyInput.value.trim();
  const diabetic = diabeticInput.value;
  const diabeticStage = diabeticStageInput.value.trim();
  const diabetesDuration = diabetesDurationInput.value.trim();
  const hypertension = getCheckedValue(hypertensionInputs);
  const hypertensionDuration = hypertensionDurationInput.value.trim();
  const cardiovascularDisease = getCheckedValue(cardiovascularDiseaseInputs);
  const familyKidneyHistory = getCheckedValue(familyKidneyHistoryInputs);
  const ultrasoundFindings = isKfre ? null : {
    right: collectKidneyFindings("right"),
    left: collectKidneyFindings("left")
  };
  const leftKidneyFile = leftKidneyFileInput.files[0];
  const rightKidneyFile = rightKidneyFileInput.files[0];
  const egfrReportFile = egfrReportInput.files[0];
  const patientPackageFile = patientPackageFileInput.files[0];
  const ultrasoundVideoFile = ultrasoundVideoFileInput.files[0];
  const kfreClinicalDocumentFile = kfreClinicalDocumentInput.files[0];

  if (!hospitalName || !hospitalId || !uhid) {
    showToast("Hospital, Hospital ID, and UHID are required.");
    return null;
  }

  if (!state.consentId) {
    showToast("Record e-consent before submitting clinical files.");
    activateTab("consent");
    return null;
  }

  if (!validateQuestionnaireForClinicalUpload()) {
    return null;
  }

  if (isKfre && !egfrForm.checkValidity()) {
    egfrForm.reportValidity();
    showToast("Complete all required KFRE clinical and outcome fields.");
    return null;
  }

  if (isKfre && Number(kfreSystolicBpInput.value) <= Number(kfreDiastolicBpInput.value)) {
    showToast("Systolic blood pressure must be greater than diastolic blood pressure.");
    kfreSystolicBpInput.focus();
    return null;
  }

  if (isKfre && kfreKidneyFailureEventInput.value === "Yes" && !validateDateInput(kfreKidneyFailureDateInput)) {
    kfreKidneyFailureDateInput.reportValidity();
    return null;
  }

  const invalidKidneyMeasurement = !isKfre && Array.from(kidneyMeasurementInputs)
    .find((input) => input.value.trim() && !validateNumericInput(input));
  if (invalidKidneyMeasurement) {
    invalidKidneyMeasurement.reportValidity();
    invalidKidneyMeasurement.focus();
    return null;
  }

  if (!age || !sex || !heightCm || !weight) {
    showToast("Age, sex, height, and weight are required.");
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

  if (ckdStage === "Other" && !ckdStageRemarks) {
    showToast("Enter remarks for Other CKD stage.");
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

  if (isKfre) {
    if (!kfreClinicalDocumentFile) {
      showToast("Upload the KFRE clinical document.");
      return null;
    }
    uploadFiles = [{ fieldName: "clinicalDocument", file: kfreClinicalDocumentFile }];
  } else if (uploadMode === "separate") {
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

  if (!isKfre && ultrasoundVideoFile) {
    uploadFiles.push({ fieldName: "ultrasoundVideo", file: ultrasoundVideoFile });
  }

  const totalBytes = uploadFiles.reduce((sum, upload) => sum + upload.file.size, 0);
  const submission = {
    hospitalId,
    hospitalName,
    hospitalSessionId: state.hospitalSession?.id || hospitalId,
    hospitalSessionName: state.hospitalSession?.name || hospitalName,
    consentId: state.consentId || null,
    studyFlow: state.studyFlow,
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
    ckdStageRemarks: ckdStage === "Other" ? ckdStageRemarks : "-",
    dialysis: ckdStage === "3" || ckdStage === "4" ? dialysis : "-",
    dialysisFrequency: ckdStage === "3" || ckdStage === "4" && dialysis === "Yes" ? dialysisFrequency : "-",
    diabetic,
    diabeticStage: diabetic === "Yes" ? diabeticStage : "-",
    diabetesDuration: diabetesDuration || "-",
    hypertension: hypertension || "-",
    hypertensionDuration: hypertensionDuration || "-",
    cardiovascularDisease: cardiovascularDisease || "-",
    familyKidneyHistory: familyKidneyHistory || "-",
    ultrasoundFindings,
    kfreForm: isKfre ? collectKfreForm() : null,
    files: uploadFiles.map((upload) => upload.file.name),
    fileCount: uploadFiles.length,
    totalBytes,
    hasVideo: Boolean(!isKfre && ultrasoundVideoFile),
    uploadFiles,
    progress: 0,
    status: "Awaiting Review",
    reviewedAt: null
  };
  submission.dataQualityWarnings = computeDataQualityWarnings(submission);
  return submission;
}

function renderReviewSubmission(submission) {
  const resumableSession = state.currentUploadSession?.signature === getSubmissionUploadSignature(submission)
    ? state.currentUploadSession
    : null;
  const detailRows = [
    ["Study Pathway", submission.studyFlow === "kfre" ? "KFRE Study" : "eGFR Study"],
    ["Hospital", submission.hospitalName],
    ["Hospital ID", submission.hospitalId],
    ["Patient ID", submission.uhid],
    ["Consent ID", submission.consentId || "-"],
    ["Study ID", submission.studyId || "-"],
    ["Enrollment Date", submission.enrollmentDate || "-"],
    ["Consent Obtained", submission.consentObtained || "-"],
    ["Upload Method", subUploadMode(submission.uploadMode)],
    ["Age", submission.age],
    ["Sex", submission.sex],
    ["Height", submission.heightCm && submission.heightCm !== "-" ? `${submission.heightCm} cm` : "-"],
    ["Weight", `${submission.weight} kg`],
    ["BMI", submission.bmi || "-"],
    ["Known CKD", submission.knownCkd || "-"],
    ["Kidney Status", formatCkdStage(submission.ckdStage, submission.ckdStageRemarks)],
    ["Dialysis", submission.dialysis || "-"],
    ["Dialysis / Week", submission.dialysisFrequency || "-"],
    ["Diabetic", submission.diabetic],
    ["Diabetes Classification", submission.diabeticStage || "-"],
    ["Hypertension", submission.hypertension || "-"],
    ["Cardiovascular Disease", submission.cardiovascularDisease || "-"],
    ["Family Kidney History", submission.familyKidneyHistory || "-"]
  ];
  const ultrasoundFindingRows = [
    ...getKidneyFindingReviewRows("Right Kidney", submission.ultrasoundFindings?.right),
    ...getKidneyFindingReviewRows("Left Kidney", submission.ultrasoundFindings?.left)
  ].filter(([, value]) => value !== "-");
  const ultrasoundFindingBlock = submission.studyFlow === "kfre" ? "" : ultrasoundFindingRows.length ? `
    <div class="review-files">
      <h3>Ultrasound Findings</h3>
      <div class="review-grid">
        ${ultrasoundFindingRows.map(([label, value]) => `
          <div class="review-item">
            <span>${escapeHTML(label)}</span>
            <strong>${escapeHTML(value)}</strong>
          </div>
        `).join("")}
      </div>
    </div>
  ` : `
    <div class="review-alert">
      No structured ultrasound findings were entered for this record.
    </div>
  `;
  const kfreRows = getKfreReviewRows(submission.kfreForm);
  const kfreBlock = submission.studyFlow === "kfre" ? `
    <div class="review-files">
      <h3>KFRE Clinical and Outcome Data</h3>
      <div class="review-grid">
        ${kfreRows.map(([label, value]) => `
          <div class="review-item">
            <span>${escapeHTML(label)}</span>
            <strong>${escapeHTML(value || "-")}</strong>
          </div>
        `).join("")}
      </div>
    </div>
  ` : "";

  const fileRows = submission.uploadFiles.map((upload) => `
    <div class="review-file">
      <span>${escapeHTML(getUploadLabel(upload.fieldName))}</span>
      <strong>${escapeHTML(upload.file.name)}</strong>
      <small>${escapeHTML(upload.file.type || "Unknown type")} • ${formatBytes(upload.file.size)}</small>
    </div>
  `).join("");
  const qualityWarnings = submission.dataQualityWarnings || [];
  const qualityBlock = qualityWarnings.length ? `
    <div class="review-alert warning">
      <strong>Data quality checks need attention:</strong>
      <ul class="review-warning-list">
        ${qualityWarnings.map((warning) => `<li>${escapeHTML(warning)}</li>`).join("")}
      </ul>
    </div>
  ` : "";

  reviewContent.innerHTML = `
    <div class="review-alert${resumableSession ? " warning" : ""}">
      ${resumableSession
        ? "An interrupted upload session was found for this patient. Click Resume Upload to continue from the last confirmed chunk."
        : "Please confirm these details. After you proceed, this record uploads directly to the VM and Cloud Storage."}
    </div>
    ${qualityBlock}
    <div class="review-grid">
      ${detailRows.map(([label, value]) => `
        <div class="review-item">
          <span>${escapeHTML(label)}</span>
          <strong>${escapeHTML(value)}</strong>
        </div>
      `).join("")}
    </div>
    ${ultrasoundFindingBlock}
    ${kfreBlock}
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
  reviewProceedBtn.textContent = state.currentUploadSession?.signature === getSubmissionUploadSignature(submission)
    ? "Resume Upload"
    : "Proceed & Upload";
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
  updateKfreConditionalFields();
  updateUploadModeVisibility();
  updateDialysisVisibility();
  updateDiabeticVisibility();
  updateLinkedPatientSummary();
}

function resetPatientIntakeForNextRecord() {
  clearDraft();           // remove localStorage draft on successful submission
  state.currentUploadSession = null;
  resetConsentRecord();
  patientStartForm.reset();
  questionnaireForm.reset();
  landingEnrollmentDateInput.value = new Date().toISOString().slice(0, 10);
  hospitalNameInput.value = landingHospitalInput.value;
  hospitalIdInput.value = landingHospitalIdInput.value;
  consentCheckbox.checked = false;
  kfreConsentCheckbox.checked = false;
  consentContinueBtn.disabled = true;
  consentContinueBtn.textContent = "Accept & Continue";
  updateQuestionnaireBmi();
  updateConsentContext();
  updateLinkedPatientSummary();
  updateHospitalSessionUI();
  applyHospitalAuthContext();
  updateWorkflowAccess();
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
  setUploadProgress(0, "Preparing resumable upload");

  try {
    const timestamp = new Date().toISOString();
    const submission = state.pendingSubmission;
    const result = await sendResumableSubmission(timestamp, submission);
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
    if (state.pendingSubmission && state.currentUploadSession?.signature === getSubmissionUploadSignature(state.pendingSubmission)) {
      renderReviewSubmission(state.pendingSubmission);
      reviewProceedBtn.textContent = "Resume Upload";
    }
    refreshDashboard();
    showToast("Upload interrupted: " + err.message + " You can resume from the review window.");
  } finally {
    reviewProceedBtn.disabled = false;
    reviewEditBtn.disabled = false;
    reviewCloseBtn.disabled = false;
    if (state.pendingSubmission && state.currentUploadSession?.signature === getSubmissionUploadSignature(state.pendingSubmission)) {
      reviewProceedBtn.textContent = "Resume Upload";
    } else {
      reviewProceedBtn.textContent = "Proceed & Upload";
    }
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

// ─── Submissions panel ────────────────────────────────────────────────────────

const subTbody          = document.getElementById("sub-tbody");
const subPageInfo       = document.getElementById("sub-page-info");
const subPrevBtn        = document.getElementById("sub-prev-btn");
const subNextBtn        = document.getElementById("sub-next-btn");
const subHospitalFilter = document.getElementById("sub-hospital-filter");
const subReviewedFilter = document.getElementById("sub-reviewed-filter");
const subSearchInput    = document.getElementById("sub-search-input");
const subDateFromInput  = document.getElementById("sub-date-from");
const subDateToInput    = document.getElementById("sub-date-to");
const subApplyBtn       = document.getElementById("sub-apply-filters");
const subResetBtn       = document.getElementById("sub-reset-filters");
const subDetailOverlay  = document.getElementById("sub-detail-overlay");
const subDetailTitle    = document.getElementById("sub-detail-title");
const subDetailSubtitle = document.getElementById("sub-detail-subtitle");
const subDetailBody     = document.getElementById("sub-detail-body");
const subDetailFooter   = document.getElementById("sub-detail-footer");
const subDetailClose    = document.getElementById("sub-detail-close");

const subState = { page: 1, total: 0, limit: 20 };

function subFormatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function subBadge(reviewed) {
  return reviewed
    ? `<span class="sub-badge sub-badge-reviewed">Reviewed</span>`
    : `<span class="sub-badge sub-badge-pending">Awaiting Review</span>`;
}

function subUploadMode(mode) {
  if (mode === "clinical_document") return "Clinical Document";
  return mode === "package" ? "ZIP Package" : "Separate Files";
}

async function loadSubmissions(page = 1) {
  if (!subTbody) return;
  subTbody.innerHTML = '<tr><td colspan="9" class="empty">Loading…</td></tr>';

  const params = new URLSearchParams({ page, limit: subState.limit });
  const hospital = subHospitalFilter?.value || "";
  const reviewed = subReviewedFilter?.value || "";
  const search   = subSearchInput?.value.trim() || "";
  const dateFrom = subDateFromInput?.value || "";
  const dateTo   = subDateToInput?.value || "";
  if (hospital) params.set("hospitalId", hospital);
  if (reviewed) params.set("reviewed",   reviewed);
  if (search)   params.set("search",     search);
  if (dateFrom) params.set("dateFrom",   dateFrom);
  if (dateTo)   params.set("dateTo",     dateTo);

  try {
    const res    = await authedFetch(`/api/submissions?${params}`);
    if (res.status === 401) { handle401(); return; }
    const result = await res.json();
    if (!res.ok || !result.ok) {
      subTbody.innerHTML = `<tr><td colspan="9" class="empty">${escapeHTML(result.error || "Failed to load.")}</td></tr>`;
      return;
    }

    subState.page  = result.page;
    subState.total = result.total;

    renderSubmissionsTable(result.items);
    updateSubPagination();
  } catch {
    subTbody.innerHTML = '<tr><td colspan="9" class="empty">Network error. Please try again.</td></tr>';
  }
}

function renderSubmissionsTable(items) {
  if (!subTbody) return;
  if (!items.length) {
    subTbody.innerHTML = '<tr><td colspan="9" class="empty">No submissions match the current filters.</td></tr>';
    return;
  }

  const start = (subState.page - 1) * subState.limit;
  subTbody.innerHTML = "";
  items.forEach((item, i) => {
    const tr = document.createElement("tr");
    tr.className = "sub-row";
    tr.dataset.recordId = item.recordId;
    tr.innerHTML = `
      <td class="sub-num">${start + i + 1}</td>
      <td class="sub-uhid">${escapeHTML(item.uhid)}</td>
      <td class="sub-hospital" title="${escapeHTML(item.hospitalName || "")}">${escapeHTML(item.hospitalId)}</td>
      <td>${escapeHTML(item.age || "—")} / ${escapeHTML(item.sex || "—")}</td>
      <td><span class="sub-stage-badge stage-${getCkdStageClass(item.ckdStage)}">${escapeHTML(formatCkdStage(item.ckdStage))}</span></td>
      <td>${escapeHTML(item.studyFlow === "kfre" ? "KFRE · Clinical Document" : subUploadMode(item.uploadMode))}</td>
      <td>${item.fileCount}</td>
      <td class="sub-date">${subFormatDate(item.receivedAt)}</td>
      <td>${subBadge(item.reviewedAt)}</td>
    `;
    tr.addEventListener("click", () => openSubmissionDetail(item.recordId));
    subTbody.appendChild(tr);
  });
}

function updateSubPagination() {
  const totalPages = Math.max(1, Math.ceil(subState.total / subState.limit));
  if (subPageInfo) subPageInfo.textContent = `Page ${subState.page} of ${totalPages} (${subState.total} record${subState.total !== 1 ? "s" : ""})`;
  if (subPrevBtn)  subPrevBtn.disabled = subState.page <= 1;
  if (subNextBtn)  subNextBtn.disabled = subState.page >= totalPages;
}

async function openSubmissionDetail(recordId) {
  if (!subDetailOverlay) return;
  subDetailOverlay.classList.remove("hidden");
  if (subDetailTitle)    subDetailTitle.textContent    = "Loading…";
  if (subDetailSubtitle) subDetailSubtitle.textContent = "";
  if (subDetailBody)     subDetailBody.innerHTML       = '<p class="sub-detail-loading">Fetching record…</p>';
  if (subDetailFooter)   subDetailFooter.innerHTML     = "";

  try {
    const res    = await authedFetch(`/api/submissions/${encodeURIComponent(recordId)}`);
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

function renderSubmissionDetail(s) {
  if (subDetailTitle)    subDetailTitle.textContent    = escapeHTML(s.uhid);
  if (subDetailSubtitle) subDetailSubtitle.textContent = `${s.hospitalName || s.hospitalId}  ·  ${subFormatDate(s.receivedAt)}`;

  const field = (label, value) => value && value !== "-"
    ? `<div class="sub-detail-field"><span class="sub-detail-key">${label}</span><span class="sub-detail-val">${escapeHTML(String(value))}</span></div>`
    : "";

  const fileList = (s.files || []).map((f) =>
    `<li class="sub-file-item"><span class="sub-file-name">${escapeHTML(f.originalName || f.storedName)}</span><span class="sub-file-size">${(f.size / 1024).toFixed(0)} KB</span></li>`
  ).join("");
  const qualityWarnings = Array.isArray(s.dataQualityWarnings) ? s.dataQualityWarnings : [];
  const ultrasoundFindingRows = [
    ...getKidneyFindingReviewRows("Right Kidney", s.ultrasoundFindings?.right),
    ...getKidneyFindingReviewRows("Left Kidney", s.ultrasoundFindings?.left)
  ].filter(([, value]) => value !== "-");
  const ultrasoundFindingSection = ultrasoundFindingRows.length ? `
    <section class="sub-detail-section">
      <h3 class="sub-detail-section-title">Ultrasound Findings</h3>
      ${ultrasoundFindingRows.map(([label, value]) => field(label, value)).join("")}
    </section>
  ` : "";
  const kfreRows = getKfreReviewRows(s.kfreForm);
  const kfreSection = s.studyFlow === "kfre" && kfreRows.length ? `
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
      ${field("Record ID",      s.recordId)}
      ${field("Participant ID", s.participantId)}
      ${field("Patient ID",     s.uhid)}
      ${field("Age",            s.age)}
      ${field("Sex",            s.sex)}
      ${field("Height (cm)",    s.heightCm)}
      ${field("Weight (kg)",    s.weight)}
      ${field("BMI",            s.bmi)}
      ${field("Ethnicity",      s.ethnicity)}
      ${field("Occupation",     s.occupation)}
    </section>
    <section class="sub-detail-section">
      <h3 class="sub-detail-section-title">Clinical</h3>
      ${field("Kidney Status",        formatCkdStage(s.ckdStage, s.ckdStageRemarks))}
      ${field("Known CKD",            s.knownCkd)}
      ${field("CKD Duration",         s.ckdDuration)}
      ${field("Dialysis",             s.dialysis)}
      ${field("Dialysis Frequency",   s.dialysisFrequency)}
      ${field("Diabetic",             s.diabetic)}
      ${field("Diabetic Stage",       s.diabeticStage)}
      ${field("Diabetes Duration",    s.diabetesDuration)}
      ${field("Hypertension",         s.hypertension)}
      ${field("Hypert. Duration",     s.hypertensionDuration)}
      ${field("Cardiovascular Dis.",  s.cardiovascularDisease)}
      ${field("Family Kidney Hist.",  s.familyKidneyHistory)}
    </section>
    ${ultrasoundFindingSection}
    ${kfreSection}
    <section class="sub-detail-section">
      <h3 class="sub-detail-section-title">Submission</h3>
      ${field("Hospital",       s.hospitalName || s.hospitalId)}
      ${field("Study Pathway",  s.studyFlow === "kfre" ? "KFRE Study" : "eGFR Study")}
      ${field("Upload Mode",    subUploadMode(s.uploadMode))}
      ${field("Enrollment Date",s.enrollmentDate)}
      ${field("Consent ID",     s.consentId)}
      ${field("Batch ID",       s.batchId)}
      ${field("Received At",    subFormatDate(s.receivedAt))}
    </section>
    ${qualitySection}
    ${fileList ? `<section class="sub-detail-section"><h3 class="sub-detail-section-title">Files</h3><ul class="sub-file-list">${fileList}</ul></section>` : ""}
    ${s.reviewedAt ? `<section class="sub-detail-section"><h3 class="sub-detail-section-title">Review</h3>${field("Reviewed At", subFormatDate(s.reviewedAt))}${field("Reviewed By", s.reviewedBy)}</section>` : ""}
  `;

  if (subDetailFooter && state.authSession?.role === "admin") {
    const isReviewed = Boolean(s.reviewedAt);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = isReviewed ? "btn-ghost sub-review-btn" : "btn-primary sub-review-btn";
    btn.textContent = isReviewed ? "Clear Review" : "Mark as Reviewed";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        const res = await authedFetch(`/api/submissions/${encodeURIComponent(s.recordId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reviewed: !isReviewed })
        });
        const result = await res.json();
        if (res.ok && result.ok) {
          // Refresh detail and table row
          openSubmissionDetail(s.recordId);
          loadSubmissions(subState.page);
        } else {
          btn.disabled = false;
          btn.textContent = isReviewed ? "Clear Review" : "Mark as Reviewed";
        }
      } catch {
        btn.disabled = false;
        btn.textContent = isReviewed ? "Clear Review" : "Mark as Reviewed";
      }
    });
    subDetailFooter.innerHTML = "";
    subDetailFooter.appendChild(btn);
  }
}

function closeSubmissionDetail() {
  subDetailOverlay?.classList.add("hidden");
}

// Populate hospital filter for admin
function populateSubHospitalFilter() {
  if (!subHospitalFilter) return;
  const isAdmin = state.authSession?.role === "admin";
  const wrap = document.getElementById("sub-hospital-filter-wrap");
  if (wrap) wrap.style.display = isAdmin ? "" : "none";
  if (!isAdmin) return;
  // Clear existing options except the first "All Hospitals"
  while (subHospitalFilter.options.length > 1) subHospitalFilter.remove(1);
  hospitals.forEach((h) => {
    const opt = document.createElement("option");
    opt.value = h.id;
    opt.textContent = h.name;
    subHospitalFilter.appendChild(opt);
  });
}

const subExportBtn = document.getElementById("sub-export-csv");

const EXPORT_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

async function exportSubmissionsCsv() {
  if (!subExportBtn) return;
  subExportBtn.disabled = true;
  subExportBtn.textContent = "Exporting…";

  try {
    const params   = new URLSearchParams();
    const hospital = subHospitalFilter?.value || "";
    const reviewed = subReviewedFilter?.value || "";
    const search   = subSearchInput?.value.trim() || "";
    const dateFrom = subDateFromInput?.value || "";
    const dateTo   = subDateToInput?.value || "";
    if (hospital) params.set("hospitalId", hospital);
    if (reviewed) params.set("reviewed",   reviewed);
    if (search)   params.set("search",     search);
    if (dateFrom) params.set("dateFrom",   dateFrom);
    if (dateTo)   params.set("dateTo",     dateTo);

    const res = await authedFetch(`/api/submissions/export?${params}`);
    if (res.status === 401) { handle401(); return; }
    if (!res.ok) {
      showToast("Export failed. Please try again.");
      return;
    }

    const blob    = await res.blob();
    const objUrl  = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const a       = document.createElement("a");
    a.href        = objUrl;
    a.download    = `tanuh-submissions-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objUrl);
    showToast("CSV downloaded successfully.");
  } catch {
    showToast("Export failed. Please try again.");
  } finally {
    subExportBtn.disabled = false;
    subExportBtn.innerHTML = `${EXPORT_ICON_SVG} Export CSV`;
  }
}

subExportBtn?.addEventListener("click", exportSubmissionsCsv);

subApplyBtn?.addEventListener("click", () => loadSubmissions(1));
subResetBtn?.addEventListener("click", () => {
  if (subHospitalFilter) subHospitalFilter.value = "";
  if (subReviewedFilter) subReviewedFilter.value = "";
  if (subSearchInput)    subSearchInput.value    = "";
  if (subDateFromInput)  subDateFromInput.value  = "";
  if (subDateToInput)    subDateToInput.value    = "";
  loadSubmissions(1);
});
subSearchInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") loadSubmissions(1); });
subDateFromInput?.addEventListener("change", () => loadSubmissions(1));
subDateToInput?.addEventListener("change", () => loadSubmissions(1));
subPrevBtn?.addEventListener("click", () => loadSubmissions(subState.page - 1));
subNextBtn?.addEventListener("click", () => loadSubmissions(subState.page + 1));
subDetailClose?.addEventListener("click", closeSubmissionDetail);
subDetailOverlay?.addEventListener("click", (e) => { if (e.target === subDetailOverlay) closeSubmissionDetail(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSubmissionDetail(); });

// ─── Login / logout event wiring ─────────────────────────────────────────────

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideLoginError();

  const username  = document.getElementById("login-username")?.value.trim() || "";
  const password  = document.getElementById("login-password")?.value || "";

  if (!username || !password) {
    showLoginError("Enter username and password.");
    return;
  }

  const submitBtn = loginForm.querySelector("[type='submit']");
  submitBtn.disabled = true;
  submitBtn.classList.add("is-loading");

  try {
    const response = await fetch("/api/auth/login", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username, password })
    });
    const result = await response.json();

    if (!response.ok || !result.ok) {
      showLoginError(result.error || "Login failed.");
      loginForm.classList.add("ls-shake");
      setTimeout(() => loginForm.classList.remove("ls-shake"), 500);
      return;
    }

    saveAuthSession({
      token:        result.token,
      userId:       result.user.userId,
      hospitalId:   result.user.hospitalId,
      hospitalName: result.user.hospitalName,
      role:         result.user.role,
      expiresAt:    result.expiresAt
    });
    saveStudyFlow(document.querySelector("input[name='loginStudyFlow']:checked")?.value);

    await loadHospitalsFromApi();
    showApp();
    applyStudyFlowUI();
    initializeGlobalValidation();
    initializeFilePreviews();
    updateUploadModeVisibility();
    updateDialysisVisibility();
    updateDiabeticVisibility();
    applyHospitalAuthContext();
    landingEnrollmentDateInput.value = new Date().toISOString().slice(0, 10);
    loadHospitalSession();
    updateConsentContext();
    updateLinkedPatientSummary();
    refreshDashboard();
  } catch {
    showLoginError("Network error. Please try again.");
    loginForm.classList.add("ls-shake");
    setTimeout(() => loginForm.classList.remove("ls-shake"), 500);
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove("is-loading");
  }
});

logoutBtn?.addEventListener("click", async () => {
  try {
    await authedFetch("/api/auth/logout", { method: "POST" });
  } catch { /* ignore */ }
  clearAuthSession();
  showLoginScreen();
  document.getElementById("login-username") && (document.getElementById("login-username").value = "");
  document.getElementById("login-password") && (document.getElementById("login-password").value = "");
});

// Password show/hide toggle
document.getElementById("ls-pw-toggle")?.addEventListener("click", () => {
  const pwInput  = document.getElementById("login-password");
  const eyeOpen  = document.getElementById("ls-eye-open");
  const eyeShut  = document.getElementById("ls-eye-shut");
  if (!pwInput) return;
  const isHidden = pwInput.type === "password";
  pwInput.type = isHidden ? "text" : "password";
  if (eyeOpen)  eyeOpen.style.display  = isHidden ? "none"  : "";
  if (eyeShut)  eyeShut.style.display  = isHidden ? ""      : "none";
});

// ─── Startup ──────────────────────────────────────────────────────────────────

(async function init() {
  initializeLandingReveal();
  loadStudyFlow();
  const storedStudyChoice = document.querySelector(`input[name='loginStudyFlow'][value='${state.studyFlow}']`);
  if (storedStudyChoice) storedStudyChoice.checked = true;

  // Check if server requires auth
  let serverAuthConfigured = true;
  try {
    const healthRes    = await fetch("/api/health");
    const healthResult = await healthRes.json();
    if (healthResult.ok) {
      serverAuthConfigured = healthResult.authConfigured !== false;
    }
  } catch { /* assume auth required */ }

  if (!serverAuthConfigured) {
    // Dev mode: no auth configured on server — skip login screen
    state.authSession = { token: "", userId: "anonymous", hospitalId: null, role: "admin" };
    await loadHospitalsFromApi();
    showApp();
  } else if (loadAuthSession()) {
    // Restore existing session
    try {
      const meRes    = await authedFetch("/api/auth/me");
      const meResult = await meRes.json();
      if (meRes.ok && meResult.ok) {
        // Session still valid — refresh user info in case it changed
        saveAuthSession({ ...state.authSession, ...meResult.user });
        await loadHospitalsFromApi();
        showApp();
        applyHospitalAuthContext();
      } else {
        clearAuthSession();
        showLoginScreen();
      }
    } catch {
      // Network error — optimistically show app with cached session
      await loadHospitalsFromApi();
      showApp();
      applyHospitalAuthContext();
    }
  } else {
    showLoginScreen();
    return; // Don't init the rest of the app yet — will happen after login
  }

  // These run only when the session is ready
  applyStudyFlowUI();
  populateHospitals();
  landingEnrollmentDateInput.value = new Date().toISOString().slice(0, 10);
  updateLandingHospitalId();
  loadHospitalSession();
  updateConsentContext();
  updateLinkedPatientSummary();
  initializeGlobalValidation();
  initializeFilePreviews();
  updateUploadModeVisibility();
  updateDialysisVisibility();
  updateDiabeticVisibility();
  refreshDashboard();
})();
