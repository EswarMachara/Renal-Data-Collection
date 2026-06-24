export const state = {
  pendingSubmission: null,
  recentUploads: [],
  uploadProgress: 0,
  hospitalSession: null,
  backendDashboard: null,
  adminDashboardView: "overview",
  hospitalDashboardView: "egfr",
  authSession: null,
  studyFlow: "egfr",
  consentId: null,
  questionnaireCompleted: false,
  currentUploadSession: null
};

export const HOSPITAL_SESSION_KEY = "renalPortalHospitalSession";
export const AUTH_SESSION_KEY = "renalPortalAuthSession";
const STUDY_FLOW_KEY = "renalPortalStudyFlow";

function normalizedStudyFlow(value) {
  return value === "kfre" ? "kfre" : "egfr";
}

export function saveStudyFlow(value) {
  state.studyFlow = normalizedStudyFlow(value);
  try { sessionStorage.setItem(STUDY_FLOW_KEY, state.studyFlow); } catch { /* ignore */ }
}

export function loadStudyFlow() {
  try {
    state.studyFlow = normalizedStudyFlow(sessionStorage.getItem(STUDY_FLOW_KEY));
  } catch {
    state.studyFlow = "egfr";
  }
  state.hospitalDashboardView = state.studyFlow;
  return state.studyFlow;
}

export function loadAuthSession() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY) || "null");
    if (stored?.token) { state.authSession = stored; return true; }
  } catch { /* ignore */ }
  return false;
}

export function saveAuthSession(sessionData) {
  state.authSession = sessionData;
  try { sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(sessionData)); } catch { /* ignore */ }
}

export function clearAuthSession() {
  state.authSession = null;
  state.hospitalSession = null;
  state.currentUploadSession = null;
  state.consentId = null;
  state.questionnaireCompleted = false;
  try { sessionStorage.removeItem(AUTH_SESSION_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(HOSPITAL_SESSION_KEY); } catch { /* ignore */ }
}
