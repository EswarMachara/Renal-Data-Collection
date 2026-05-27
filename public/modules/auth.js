import { state, HOSPITAL_SESSION_KEY } from "./state.js";
import { hospitals } from "./api.js";
import { showToast } from "./utils.js";

const ADMIN_INTAKE_SOURCE = { id: "TANUH-ADMIN", name: "Admin" };
let authCallbacks = {
  setMobileNavigationOpen: () => {},
  populateSubHospitalFilter: () => {},
  updateWorkflowAccess: () => {}
};

export function configureAuthCallbacks(callbacks) {
  authCallbacks = { ...authCallbacks, ...callbacks };
}

function getSelectableIntakeSources() {
  return state.authSession?.role === "admin"
    ? [...hospitals, ADMIN_INTAKE_SOURCE]
    : hospitals;
}

function setPatientFieldsEnabled(isEnabled) {
  [
    document.getElementById("landing-uhid"),
    document.getElementById("landing-study-id"),
    document.getElementById("landing-enrollment-date"),
    document.getElementById("start-patient-consent")
  ].forEach((input) => {
    if (input) input.disabled = !isEnabled;
  });
}

export function showLoginError(message, { retryable = false } = {}) {
  const loginError = document.getElementById("login-error");
  const loginErrorMessage = document.getElementById("login-error-message");
  const loginErrorRetry = document.getElementById("login-error-retry");
  if (!loginError) return;
  if (loginErrorMessage) {
    loginErrorMessage.textContent = message;
  } else {
    loginError.textContent = message;
  }
  loginErrorRetry?.classList.toggle("hidden", !retryable);
  loginError.classList.remove("hidden");
}

export function hideLoginError() {
  const loginError = document.getElementById("login-error");
  const loginErrorMessage = document.getElementById("login-error-message");
  const loginErrorRetry = document.getElementById("login-error-retry");
  if (!loginError) return;
  loginError.classList.add("hidden");
  if (loginErrorMessage) {
    loginErrorMessage.textContent = "";
  } else {
    loginError.textContent = "";
  }
  loginErrorRetry?.classList.add("hidden");
}

export function updateHospitalSessionUI() {
  const activeHospitalName = document.getElementById("active-hospital-name");
  const activeHospitalId = document.getElementById("active-hospital-id");
  const session = state.hospitalSession;
  const hasSession = Boolean(session);

  if (activeHospitalName) activeHospitalName.textContent = session?.name || "No hospital selected";
  if (activeHospitalId) activeHospitalId.textContent = session ? `Hospital ID: ${session.id}` : "Save hospital session first";
  setPatientFieldsEnabled(hasSession);
}

export function applyHospitalAuthContext() {
  const landingHospitalInput = document.getElementById("landing-hospital");
  const hospitalNameInput = document.getElementById("hospital-name");
  const hospitalIdInput = document.getElementById("hospital-id");
  const landingHospitalIdInput = document.getElementById("landing-hospital-id");
  const session = state.authSession;
  const sessionInstruction = document.getElementById("hospital-session-instruction");
  const saveSessionButton = document.getElementById("save-hospital-session");
  if (!session || session.role === "admin") {
    if (landingHospitalInput) landingHospitalInput.disabled = false;
    if (hospitalNameInput) hospitalNameInput.disabled = false;
    if (sessionInstruction) {
      sessionInstruction.textContent = session?.role === "admin"
        ? "Select Admin or a hospital as the intake source for this patient record."
        : "Choose once at the start of the day or browser session.";
    }
    if (saveSessionButton) saveSessionButton.classList.remove("hidden");
    return;
  }

  if (session.hospitalId) {
    const hospital = hospitals.find((entry) => entry.id === session.hospitalId);
    if (landingHospitalInput) {
      landingHospitalInput.value = session.hospitalId;
      landingHospitalInput.disabled = true;
    }
    if (hospitalNameInput) {
      hospitalNameInput.value = session.hospitalId;
      hospitalNameInput.disabled = true;
    }
    if (hospitalIdInput) hospitalIdInput.value = session.hospitalId;
    if (landingHospitalIdInput) landingHospitalIdInput.value = session.hospitalId;
    if (sessionInstruction) sessionInstruction.textContent = "Assigned automatically from your secure hospital account.";
    if (saveSessionButton) saveSessionButton.classList.add("hidden");

    const hospitalName = hospital?.name || state.authSession.hospitalName || session.hospitalId;
    state.hospitalSession = { id: session.hospitalId, name: hospitalName };
    try { sessionStorage.setItem(HOSPITAL_SESSION_KEY, JSON.stringify(state.hospitalSession)); } catch { /* ignore */ }
    updateHospitalSessionUI();
  }
}

export function showApp() {
  const loginScreen = document.getElementById("login-screen");
  const appNavbar = document.getElementById("app-navbar");
  const navbarAuth = document.getElementById("navbar-auth");
  const navbarUserLabel = document.getElementById("navbar-user-label");
  authCallbacks.setMobileNavigationOpen(false);
  if (loginScreen) loginScreen.classList.add("hidden");
  if (appNavbar) appNavbar.classList.remove("hidden");
  document.querySelector(".app-container")?.classList.remove("hidden");

  const session = state.authSession;
  if (navbarUserLabel && session) {
    navbarUserLabel.textContent = session.role === "admin"
      ? "Admin"
      : (session.hospitalId || session.userId || "");
  }
  if (navbarAuth) navbarAuth.classList.remove("hidden");

  const submissionsNavBtn = document.getElementById("submissions-nav");
  submissionsNavBtn?.classList.remove("hidden");
  authCallbacks.populateSubHospitalFilter();
  authCallbacks.updateWorkflowAccess();
}

export function showLoginScreen() {
  const loginScreen = document.getElementById("login-screen");
  const appNavbar = document.getElementById("app-navbar");
  authCallbacks.setMobileNavigationOpen(false);
  if (loginScreen) loginScreen.classList.remove("hidden");
  if (appNavbar) appNavbar.classList.add("hidden");
  document.querySelector(".app-container")?.classList.add("hidden");
}

export function saveHospitalSession() {
  const landingHospitalInput = document.getElementById("landing-hospital");
  const hospital = getSelectableIntakeSources().find((entry) => entry.id === landingHospitalInput?.value) || null;
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
  showToast(state.authSession?.role === "admin"
    ? "Admin upload session saved. You can now add patients for this intake source."
    : "Hospital session saved. You can now add patients.");
  return true;
}

export function loadHospitalSession() {
  const landingHospitalInput = document.getElementById("landing-hospital");
  const landingHospitalIdInput = document.getElementById("landing-hospital-id");
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

  if (storedSession?.id && getSelectableIntakeSources().some((hospital) => hospital.id === storedSession.id)) {
    if (landingHospitalInput) landingHospitalInput.value = storedSession.id;
    state.hospitalSession = storedSession;
    if (landingHospitalIdInput) landingHospitalIdInput.value = landingHospitalInput?.value || "";
  }

  updateHospitalSessionUI();
}
