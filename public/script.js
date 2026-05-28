import {
  state,
  loadAuthSession,
  saveAuthSession,
  clearAuthSession as clearStoredAuthSession,
  saveStudyFlow,
  loadStudyFlow
} from "./modules/state.js";
import {
  showToast,
  escapeHTML,
  formatCkdStage,
  cleanIdentifier,
  cleanDecimalValue,
  validateDateInput,
  formatDisplayDate,
  formatBytes,
  getUploadLabel
} from "./modules/utils.js";
import {
  hospitals,
  authedFetch,
  loadHospitalsFromApi as fetchHospitalsFromApi,
  handle401,
  setUnauthorizedHandler
} from "./modules/api.js";
import {
  configureAuthCallbacks,
  showLoginError,
  hideLoginError,
  applyHospitalAuthContext,
  showApp,
  showLoginScreen,
  updateHospitalSessionUI,
  loadHospitalSession,
  saveHospitalSession
} from "./modules/auth.js";
import {
  updateDashboards,
  loadBackendDashboard,
  refreshDashboard
} from "./modules/dashboard.js";
import {
  subState,
  subUploadMode,
  configureSubmissionRenderers,
  loadSubmissions,
  closeSubmissionDetail,
  populateSubHospitalFilter,
  exportSubmissionsCsv
} from "./modules/submissions.js";
import {
  showAdminPortal,
  hideAdminPortal,
  initAdminPortal,
  setAdminLogoutCallback,
} from "./modules/admin.js";

const RESUMABLE_UPLOAD_RETRIES = 3;

const ADMIN_INTAKE_SOURCE = { id: "TANUH-ADMIN", name: "Admin" };

function getSelectableIntakeSources() {
  return state.authSession?.role === "admin"
    ? [...hospitals, ADMIN_INTAKE_SOURCE]
    : hospitals;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

const loginScreen   = document.getElementById("login-screen");
const appNavbar     = document.getElementById("app-navbar");
const loginForm     = document.getElementById("login-form");
const loginError    = document.getElementById("login-error");
const loginErrorMessage = document.getElementById("login-error-message");
const loginErrorRetry = document.getElementById("login-error-retry");
const navbarAuth    = document.getElementById("navbar-auth");
const navbarUserLabel = document.getElementById("navbar-user-label");
const navbarMenuToggle = document.getElementById("navbar-menu-toggle");
const logoutBtn     = document.getElementById("logout-btn");
const LOGIN_REQUEST_TIMEOUT_MS = 12000;

function clearAuthSession() {
  clearStoredAuthSession();
  resetConsentRecord();
}

function setMobileNavigationOpen(isOpen) {
  if (!appNavbar || !navbarMenuToggle) return;
  appNavbar.classList.toggle("mobile-menu-open", isOpen);
  navbarMenuToggle.setAttribute("aria-expanded", String(isOpen));
  navbarMenuToggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
}

function initializeMobileNavigation() {
  if (!appNavbar || !navbarMenuToggle) return;

  navbarMenuToggle.addEventListener("click", () => {
    setMobileNavigationOpen(!appNavbar.classList.contains("mobile-menu-open"));
  });

  appNavbar.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setMobileNavigationOpen(false);
    navbarMenuToggle.focus();
  });

  window.matchMedia("(min-width: 861px)").addEventListener("change", (event) => {
    if (event.matches) setMobileNavigationOpen(false);
  });
}

function loadHospitalsFromApi() {
  return fetchHospitalsFromApi(populateHospitals);
}

configureAuthCallbacks({
  setMobileNavigationOpen,
  populateSubHospitalFilter,
  updateWorkflowAccess,
  initAdminPortal,
  showAdminPortal,
  hideAdminPortal,
});

setAdminLogoutCallback(async () => {
  try { await authedFetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
  clearAuthSession();
  showLoginScreen();
});
configureSubmissionRenderers({
  getKidneyFindingReviewRows,
  getUltrasoundQualityReviewRows,
  getKfreReviewRows
});
setUnauthorizedHandler(() => {
  clearAuthSession();
  showLoginScreen();
  showToast("Your session has expired. Please sign in again.");
});

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
const demoAutofillBtn = document.getElementById("demo-autofill");
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
  updateGeneratedStudyId();
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
  updateDemoAutofillVisibility();
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
const reviewTitle = document.getElementById("review-title");
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

function populateHospitals() {
  const intakeSources = getSelectableIntakeSources();
  [landingHospitalInput, hospitalNameInput].forEach((select) => {
    // Clear all options except the first placeholder
    while (select.options.length > 1) select.remove(1);
    intakeSources.forEach((hospital) => {
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
  updateGeneratedStudyId();
}

function getActiveTabKey() {
  const activePanel = Object.entries(panels).find(([, panel]) => panel?.classList.contains("visible"));
  return activePanel?.[0] || "landing";
}

function isDemoIntakeActive() {
  return (
    state.hospitalSession?.id === "HOSP-DEMO" ||
    hospitalIdInput.value === "HOSP-DEMO" ||
    landingHospitalInput.value === "HOSP-DEMO" ||
    state.authSession?.hospitalId === "HOSP-DEMO"
  );
}

function updateDemoAutofillVisibility() {
  if (!demoAutofillBtn) return;
  const activeTab = getActiveTabKey();
  const supportedTab = ["landing", "consent", "questionnaire", "egfr"].includes(activeTab);
  const appVisible = !document.querySelector(".app-container")?.classList.contains("hidden");
  demoAutofillBtn.classList.toggle("hidden", !appVisible || !supportedTab || !isDemoIntakeActive());
}

function getStudyIdPrefix() {
  return state.studyFlow === "kfre" ? "KFRE" : "EGFR";
}

function studyIdComponent(value, maxLength = 36) {
  return cleanIdentifier(value).replace(/[._]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toUpperCase().slice(0, maxLength);
}

function generateStudyId(hospitalId, uhid) {
  const hospitalCode = studyIdComponent(hospitalId, 24);
  const patientCode = studyIdComponent(uhid, 40);
  return hospitalCode && patientCode ? `${getStudyIdPrefix()}-${hospitalCode}-${patientCode}` : "";
}

function updateGeneratedStudyId() {
  const generatedStudyId = generateStudyId(landingHospitalIdInput.value || landingHospitalInput.value, landingUhidInput.value);
  landingStudyIdInput.value = generatedStudyId;
  if (!studyIdInput.value || studyIdInput.readOnly) {
    studyIdInput.value = generatedStudyId;
  }
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

function setDemoValue(input, value) {
  if (!input) return;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setDemoRadio(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`);
  if (!input) return;
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function getDemoPatientId() {
  return `DEMO-${new Date().toISOString().replace(/\D/g, "").slice(4, 12)}`;
}

function fillDemoLanding() {
  if (landingHospitalInput.value !== "HOSP-DEMO") {
    setDemoValue(landingHospitalInput, "HOSP-DEMO");
    updateLandingHospitalId();
    saveHospitalSession();
  }
  setDemoValue(landingUhidInput, landingUhidInput.value || getDemoPatientId());
  setDemoValue(landingEnrollmentDateInput, new Date().toISOString().slice(0, 10));
  updateGeneratedStudyId();
  updateHospitalSessionUI();
  updateWorkflowAccess();
  showToast("Demo patient setup filled for HOSP-DEMO.");
}

function fillDemoConsent() {
  if (!getWorkflowAccess().consent) {
    showToast("Complete demo patient setup before consent.");
    activateTab("landing");
    return;
  }
  const checkbox = state.studyFlow === "kfre" ? kfreConsentCheckbox : consentCheckbox;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  showToast("Demo consent confirmation selected. Click Accept & Continue.");
}

function fillDemoQuestionnaire() {
  if (questionnaireForm.classList.contains("preview-locked")) {
    showToast("Record e-consent before using demo questionnaire fill.");
    return;
  }

  setDemoValue(siteCenterInput, "HOSP-DEMO Research Desk");
  setDemoRadio("consentObtained", "Yes");
  setDemoValue(ageInput, "52");
  setDemoRadio("questionnaireSex", "Female");
  setDemoValue(heightInput, "162");
  setDemoValue(weightInput, "68");
  updateQuestionnaireBmi();
  setDemoValue(ethnicityInput, "Indian");
  setDemoValue(occupationInput, "Teacher");
  setDemoRadio("knownCkd", "Yes");
  setDemoValue(ckdDurationInput, "2 years");
  setDemoValue(ckdStageInput, "2");
  updateDialysisVisibility();
  setDemoRadio("diabetesMellitus", "Yes");
  updateDiabeticVisibility();
  setDemoValue(diabeticStageInput, "Type 2 diabetes");
  setDemoValue(diabetesDurationInput, "6");
  setDemoRadio("hypertension", "Yes");
  setDemoValue(hypertensionDurationInput, "4");
  setDemoRadio("cardiovascularDisease", "No");
  setDemoRadio("familyKidneyHistory", "No");
  updateLinkedPatientSummary();
  updateQuestionnaireContinueState();
  showToast("Questionnaire demo values filled. Review once, then continue.");
}

function fillDemoEgfrFlow() {
  if (egfrForm.classList.contains("preview-locked")) {
    showToast("Complete the questionnaire before using clinical demo fill.");
    return;
  }

  if (state.studyFlow === "kfre") {
    setDemoValue(kfreSystolicBpInput, "128");
    setDemoValue(kfreDiastolicBpInput, "82");
    setDemoValue(kfreHeartRateInput, "76");
    setDemoValue(kfreWaistHipRatioInput, "0.91");
    setDemoValue(kfreFollowupStatusInput, "None");
    updateKfreConditionalFields({ clearHidden: true });
    setDemoValue(kfreOutcomeCkdStageInput, "2");
    setDemoValue(kfreRapidProgressionInput, "No");
    setDemoValue(kfreKidneyFailureEventInput, "No");
    updateKfreConditionalFields({ clearHidden: true });
    showToast("KFRE demo clinical values filled. Upload the clinical document manually.");
    return;
  }

  setDemoValue(document.getElementById("right-kidney-length"), "10.5");
  setDemoValue(document.getElementById("right-kidney-width"), "4.8");
  setDemoValue(document.getElementById("right-cortical-thickness"), "8.2");
  setDemoRadio("rightEchogenicity", "Normal");
  setDemoRadio("rightKidneySize", "Normal");
  setDemoRadio("rightParenchymalTexture", "Normal");
  setDemoRadio("rightCysts", "No");
  setDemoRadio("rightStones", "No");
  setDemoRadio("rightHydronephrosis", "No");
  setDemoValue(document.getElementById("right-other-findings"), "No focal abnormality noted");

  setDemoValue(document.getElementById("left-kidney-length"), "10.2");
  setDemoValue(document.getElementById("left-kidney-width"), "4.6");
  setDemoValue(document.getElementById("left-cortical-thickness"), "8.0");
  setDemoRadio("leftEchogenicity", "Normal");
  setDemoRadio("leftKidneySize", "Normal");
  setDemoRadio("leftParenchymalTexture", "Normal");
  setDemoRadio("leftCysts", "No");
  setDemoRadio("leftStones", "No");
  setDemoRadio("leftHydronephrosis", "No");
  setDemoValue(document.getElementById("left-other-findings"), "No focal abnormality noted");

  setDemoRadio("imageQualityAdequate", "Yes");
  setDemoRadio("kidneyBoundingPointsDetected", "Yes");
  showToast("Ultrasound findings filled. Upload images, PDF, or ZIP manually before submitting.");
}

function fillCurrentDemoPage() {
  if (!isDemoIntakeActive()) {
    showToast("Demo auto-fill is available only for HOSP-DEMO.");
    return;
  }
  const activeTab = getActiveTabKey();
  if (activeTab === "landing") fillDemoLanding();
  else if (activeTab === "consent") fillDemoConsent();
  else if (activeTab === "questionnaire") fillDemoQuestionnaire();
  else if (activeTab === "egfr") fillDemoEgfrFlow();
  else showToast("Demo auto-fill is available on intake pages only.");
  updateDemoAutofillVisibility();
}

function getCheckedValue(inputs) {
  return Array.from(inputs).find((input) => input.checked)?.value || "";
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
      if (input === landingUhidInput) updateGeneratedStudyId();
    });
  });

  [landingEnrollmentDateInput, enrollmentDateInput].forEach((input) => {
    input.addEventListener("change", () => validateDateInput(input));
  });
}

function updateLinkedPatientSummary() {
  const selectedHospital = getSelectableIntakeSources().find((hospital) => hospital.id === hospitalNameInput.value);
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

function updateConsentContext() {
  const selectedHospital = getSelectableIntakeSources().find((hospital) => hospital.id === hospitalNameInput.value);
  const hospitalName = selectedHospital?.name || "--";
  const patientId = uhidInput.value.trim() || "--";

  consentContextPatient.textContent = patientId === "--" ? "No patient selected" : `Patient ${patientId}`;
  consentContextHospital.textContent = hospitalName;
  consentContextHospitalId.textContent = hospitalIdInput.value || "--";
  consentContextUhid.textContent = patientId;
  consentContextDate.textContent = formatDisplayDate(document.getElementById("enrollment-date").value);
}

function syncIntakeToQuestionnaire() {
  updateGeneratedStudyId();
  hospitalNameInput.value = landingHospitalInput.value;
  studyIdInput.value = landingStudyIdInput.value.trim();
  hospitalIdInput.value = landingHospitalIdInput.value;
  uhidInput.value = landingUhidInput.value.trim();
  enrollmentDateInput.value = landingEnrollmentDateInput.value;
  updateConsentContext();
  updateLinkedPatientSummary();
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
  ].filter(([input]) => input).forEach(([input, fieldName]) => {
    renderFilePreview(input, fieldName);
    input.addEventListener("change", () => renderFilePreview(input, fieldName));
  });
}

function activateTab(tabKey) {
  setMobileNavigationOpen(false);
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
  updateDemoAutofillVisibility();
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
  updateGeneratedStudyId();
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
    updateGeneratedStudyId();
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

  updateGeneratedStudyId();
  if (!landingStudyIdInput.value.trim()) {
    showToast("Study ID could not be generated. Verify hospital and Patient Unique ID.");
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
    updateQuestionnaireContinueState();
    return;
  }

  const heightMeters = heightCm / 100;
  questionnaireBmiInput.value = (weightKg / (heightMeters * heightMeters)).toFixed(1);
  updateQuestionnaireContinueState();
}

function isQuestionnaireReadyForClinicalFlow() {
  const requiresDialysis = ["3a", "3b", "4", "5"].includes(ckdStageInput.value);
  const calculatedBmi = Number(bmiInput.value);
  return Boolean(
    hospitalIdInput.value &&
    uhidInput.value.trim() &&
    enrollmentDateInput.value &&
    ageInput.value.trim() &&
    Number(ageInput.value) >= 18 &&
    Number(ageInput.value) <= 120 &&
    sexInput.value &&
    heightInput.value.trim() &&
    Number(heightInput.value) >= 50 &&
    Number(heightInput.value) <= 250 &&
    weightInput.value.trim() &&
    Number(weightInput.value) >= 10 &&
    Number(weightInput.value) <= 400 &&
    Number.isFinite(calculatedBmi) &&
    calculatedBmi >= 5 &&
    calculatedBmi <= 100 &&
    ckdStageInput.value &&
    (ckdStageInput.value !== "Other" || ckdStageRemarksInput.value.trim()) &&
    (!requiresDialysis || dialysisInput.value) &&
    (!requiresDialysis || dialysisInput.value !== "Yes" || dialysisFrequencyInput.value.trim()) &&
    diabeticInput.value &&
    (diabeticInput.value !== "Yes" || diabeticStageInput.value)
  );
}

function updateQuestionnaireContinueState() {
  questionnaireContinueBtn.classList.toggle("is-ready", isQuestionnaireReadyForClinicalFlow());
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
questionnaireForm.addEventListener("input", updateQuestionnaireContinueState);
questionnaireForm.addEventListener("change", updateQuestionnaireContinueState);
questionnaireContinueBtn.addEventListener("click", () => {
  if (!questionnaireForm.checkValidity()) {
    questionnaireForm.reportValidity();
    updateQuestionnaireContinueState();
    return;
  }

  if (!validateQuestionnaireForClinicalUpload()) {
    updateQuestionnaireContinueState();
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
      .filter(Boolean)
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
  packageUploadSection?.classList.toggle("hidden", mode !== "package");

  leftKidneyFileInput.required = mode === "separate";
  rightKidneyFileInput.required = mode === "separate";
  egfrReportInput.required = mode === "separate";
  if (patientPackageFileInput) {
    patientPackageFileInput.required = mode === "package";
  }

  if (mode === "separate") {
    if (patientPackageFileInput) {
      patientPackageFileInput.value = "";
      renderFilePreview(patientPackageFileInput, "patientPackage");
    }
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
demoAutofillBtn?.addEventListener("click", fillCurrentDemoPage);
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
  updateQuestionnaireContinueState();
}

function updateDiabeticVisibility() {
  const isDiabetic = diabeticInput.value === "Yes";
  diabeticStageBlock.classList.toggle("hidden", !isDiabetic);
  if (!isDiabetic) {
    diabeticStageInput.value = "";
  }
  updateLinkedPatientSummary();
  updateQuestionnaireContinueState();
}

ckdStageInput.addEventListener("change", updateDialysisVisibility);
diabeticInput.addEventListener("change", updateDiabeticVisibility);

const adminDashboardTabs = [...document.querySelectorAll("[data-admin-dashboard-view]")];
adminDashboardTabs.forEach((button, index) => {
  button.addEventListener("click", () => {
    state.adminDashboardView = button.dataset.adminDashboardView;
    updateDashboards();
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const nextButton = adminDashboardTabs[(index + offset + adminDashboardTabs.length) % adminDashboardTabs.length];
    nextButton.focus();
    nextButton.click();
  });
});

function setUploadProgress(progress, label) {
  const normalizedProgress = Math.max(0, Math.min(100, Math.round(progress)));
  state.uploadProgress = normalizedProgress;
  uploadProgressPanel.classList.remove("hidden");
  uploadProgressFill.value = normalizedProgress;
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
  uploadProgressFill.value = 0;
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

function collectUltrasoundQualityFindings() {
  return {
    imageQuality: {
      adequateForAnalysis: getSelectedChoiceValue("imageQualityAdequate")
    },
    annotationDetails: {
      kidneyBoundingPointsDetected: getSelectedChoiceValue("kidneyBoundingPointsDetected")
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

function getUltrasoundQualityReviewRows(findings) {
  return [
    ["Image Adequate for Analysis", findings?.imageQuality?.adequateForAnalysis || "-"],
    ["Kidney Bounding Points Detected", findings?.annotationDetails?.kidneyBoundingPointsDetected || "-"]
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
  const selectedHospital = getSelectableIntakeSources().find((hospital) => hospital.id === hospitalNameInput.value);
  const isKfre = state.studyFlow === "kfre";
  const uploadMode = getUploadMode();
  const hospitalId = hospitalIdInput.value.trim();
  const hospitalName = selectedHospital?.name || "";
  const uhid = uhidInput.value.trim();
  const studyId = generateStudyId(hospitalId, uhid);
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
    left: collectKidneyFindings("left"),
    ...collectUltrasoundQualityFindings()
  };
  const leftKidneyFile = leftKidneyFileInput.files[0];
  const rightKidneyFile = rightKidneyFileInput.files[0];
  const egfrReportFile = egfrReportInput.files[0];
  const patientPackageFile = patientPackageFileInput?.files[0];
  const ultrasoundVideoFile = ultrasoundVideoFileInput.files[0];
  const kfreClinicalDocumentFile = kfreClinicalDocumentInput.files[0];

  if (!hospitalName || !hospitalId || !uhid) {
    showToast("Hospital, Hospital ID, and UHID are required.");
    return null;
  }

  studyIdInput.value = studyId;
  if (!studyId) {
    showToast("Study ID could not be generated. Verify hospital and Patient Unique ID.");
    activateTab("landing");
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
    studyId,
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
    ...getKidneyFindingReviewRows("Left Kidney", submission.ultrasoundFindings?.left),
    ...getUltrasoundQualityReviewRows(submission.ultrasoundFindings)
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
  if (reviewTitle) {
    reviewTitle.textContent = submission.studyFlow === "kfre" ? "Review KFRE Record" : "Review eGFR Record";
  }
  resetUploadProgress();
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
  updateGeneratedStudyId();
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
    await new Promise((resolve) => window.setTimeout(resolve, 500));

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

const subExportBtn = document.getElementById("sub-export-csv");

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

loginErrorRetry?.addEventListener("click", () => {
  hideLoginError();
  loginForm?.requestSubmit();
});

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
  const requestController = new AbortController();
  const requestTimeout = window.setTimeout(() => requestController.abort(), LOGIN_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("/api/auth/login", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username, password }),
      signal:  requestController.signal
    });
    let result;
    try {
      result = await response.json();
    } catch {
      showLoginError(
        response.status >= 500
          ? "The portal server is temporarily unavailable. Please try again."
          : "The portal returned an unexpected response. Please try again.",
        { retryable: true }
      );
      return;
    }

    if (!response.ok || !result.ok) {
      showLoginError(
        result.error || (response.status >= 500 ? "The portal server is temporarily unavailable. Please try again." : "Login failed."),
        { retryable: response.status >= 500 }
      );
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
    updateGeneratedStudyId();
    updateConsentContext();
    updateLinkedPatientSummary();
    refreshDashboard();
  } catch (error) {
    if (error?.name === "AbortError") {
      showLoginError("The connection is taking too long. Please retry.", { retryable: true });
    } else if (navigator.onLine === false) {
      showLoginError("You appear to be offline. Check your internet connection and retry.", { retryable: true });
    } else {
      showLoginError("Could not reach the portal. Check your connection and retry.", { retryable: true });
    }
    loginForm.classList.add("ls-shake");
    setTimeout(() => loginForm.classList.remove("ls-shake"), 500);
  } finally {
    window.clearTimeout(requestTimeout);
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
  eyeOpen?.classList.toggle("hidden", isHidden);
  eyeShut?.classList.toggle("hidden", !isHidden);
});

// ─── Startup ──────────────────────────────────────────────────────────────────

(async function init() {
  initializeLandingReveal();
  initializeMobileNavigation();
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
  updateGeneratedStudyId();
  updateConsentContext();
  updateLinkedPatientSummary();
  initializeGlobalValidation();
  initializeFilePreviews();
  updateUploadModeVisibility();
  updateDialysisVisibility();
  updateDiabeticVisibility();
  refreshDashboard();
})();
