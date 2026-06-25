const kfreOnlyMarkers = document.querySelectorAll("[data-kfre-only]");
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
  showPublicScreen,
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
const MAX_UPLOAD_FILE_BYTES = 250 * 1024 * 1024;
const MAX_UPLOAD_FILE_LABEL = formatBytes(MAX_UPLOAD_FILE_BYTES);
const PUBLIC_DASHBOARD_CACHE_KEY = "tanuh-public-dashboard-summary-v1";
const publicMetricAnimations = new Map();

const ADMIN_INTAKE_SOURCE = { id: "TANUH-ADMIN", name: "Admin" };
const INDIA_COORDINATE_LIMITS = { minLat: 6, maxLat: 38, minLng: 68, maxLng: 98 };
let publicMapState = {
  mapData: null,
  hospitals: null,
  projection: null,
  loadPromise: null
};
let pendingAnonymizationOpen = false;

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
const studyFlowSwitch = document.getElementById("study-flow-switch");
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

function setPublicText(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    element.textContent = value;
    return;
  }

  const target = Math.max(0, Math.round(numericValue));
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const current = Number(String(element.textContent || "").replace(/[^\d.-]/g, ""));
  const start = Number.isFinite(current) ? current : 0;
  if (prefersReducedMotion || start === target) {
    element.textContent = target.toLocaleString("en-IN");
    return;
  }

  if (publicMetricAnimations.has(id)) {
    cancelAnimationFrame(publicMetricAnimations.get(id));
  }

  const duration = 850;
  const startTime = performance.now();
  const animate = (timestamp) => {
    const progress = Math.min((timestamp - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const nextValue = Math.round(start + (target - start) * eased);
    element.textContent = nextValue.toLocaleString("en-IN");
    if (progress < 1) {
      publicMetricAnimations.set(id, requestAnimationFrame(animate));
      return;
    }
    publicMetricAnimations.delete(id);
    element.textContent = target.toLocaleString("en-IN");
  };
  publicMetricAnimations.set(id, requestAnimationFrame(animate));
}

function renderPublicBars(containerId, rows) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const cleanRows = rows.filter((row) => Number(row.value) > 0 || Number(row.count) > 0);
  if (!cleanRows.length) {
    container.innerHTML = '<p class="public-empty">No records yet.</p>';
    return;
  }
  const maxValue = Math.max(...cleanRows.map((row) => Number(row.value ?? row.count ?? 0)), 1);
  container.innerHTML = "";
  cleanRows.forEach((row) => {
    const value = Number(row.value ?? row.count ?? 0);
    const width = Math.max(Math.round((value / maxValue) * 100), 4);
    const barRow = document.createElement("div");
    barRow.className = "public-bar-row";
    const label = document.createElement("div");
    label.className = "public-bar-label";
    const labelText = document.createElement("span");
    labelText.textContent = row.label || row.bucket || "Unknown";
    const labelValue = document.createElement("strong");
    labelValue.textContent = value;
    label.append(labelText, labelValue);
    const track = document.createElement("div");
    track.className = "public-bar-track";
    const fill = document.createElement("span");
    fill.style.width = `${width}%`;
    track.appendChild(fill);
    barRow.append(label, track);
    container.appendChild(barRow);
  });
}

function setPublicMapStatus(message, state = "") {
  const status = document.getElementById("public-map-status");
  if (!status) return;
  status.textContent = message || "";
  status.className = `public-map-status${state ? ` ${state}` : ""}${message ? "" : " hidden"}`;
}

function isValidIndiaCoordinate(hospital) {
  const lat = Number(hospital.latitude);
  const lng = Number(hospital.longitude);
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= INDIA_COORDINATE_LIMITS.minLat &&
    lat <= INDIA_COORDINATE_LIMITS.maxLat &&
    lng >= INDIA_COORDINATE_LIMITS.minLng &&
    lng <= INDIA_COORDINATE_LIMITS.maxLng;
}

async function loadPublicMapAssets() {
  if (!publicMapState.loadPromise) {
    publicMapState.loadPromise = Promise.all([
      fetch("/maps/india_states_paths.json", { cache: "force-cache" }).then((res) => {
        if (!res.ok) throw new Error("India map dataset could not be loaded.");
        return res.json();
      }),
      fetch("/maps/partner_hospitals.json", { cache: "force-cache" }).then((res) => {
        if (!res.ok) throw new Error("Partner hospital location data could not be loaded.");
        return res.json();
      })
    ]).then(([mapData, hospitalsData]) => {
      publicMapState.mapData = mapData;
      publicMapState.hospitals = Array.isArray(hospitalsData) ? hospitalsData : [];
      publicMapState.projection = mapData.projection;
      return publicMapState;
    });
  }
  return publicMapState.loadPromise;
}

function renderIndiaStates(mapData) {
  const statesLayer = document.getElementById("india-map-states");
  if (!statesLayer || statesLayer.dataset.rendered === "true") return;
  statesLayer.innerHTML = "";
  (mapData.states || []).forEach((statePath) => {
    if (!statePath.path) return;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", statePath.path);
    path.setAttribute("class", "india-state");
    path.setAttribute("aria-label", [statePath.name, statePath.state].filter(Boolean).join(", ") || "Indian administrative region");
    statesLayer.appendChild(path);
  });
  statesLayer.dataset.rendered = "true";
}

function projectIndiaCoordinate(projection, lng, lat) {
  if (!projection || !Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) return null;
  return [
    projection.offsetX + (Number(lng) - projection.minLng) * projection.scale,
    projection.offsetY + (projection.maxLat - Number(lat)) * projection.scale
  ];
}

function getMapTooltipHtml(group) {
  const cityState = [group.city, group.state].filter(Boolean).join(", ");
  const hospitalsList = group.hospitals.map((hospital) =>
    `<li><strong>${escapeHTML(hospital.name)}</strong><span>${Number(hospital.patients || 0)} records</span></li>`
  ).join("");
  return `
    <ul>${hospitalsList}</ul>
    <div class="map-tip-location">${escapeHTML(cityState || "Partner location")}</div>
  `;
}

function showPublicMapTooltip(group, marker) {
  const tooltip = document.getElementById("public-map-tooltip");
  const wrap = document.getElementById("public-map-wrap");
  if (!tooltip || !wrap || !marker) return;
  tooltip.innerHTML = getMapTooltipHtml(group);
  const markerTarget = marker.querySelector(".marker-pin") || marker;
  const markerRect = markerTarget.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  tooltip.style.left = `${markerRect.left - wrapRect.left + markerRect.width / 2}px`;
  tooltip.style.top = `${markerRect.top - wrapRect.top}px`;
  tooltip.classList.remove("hidden");
}

function hidePublicMapTooltip() {
  document.getElementById("public-map-tooltip")?.classList.add("hidden");
}

function buildHospitalLocationGroups(apiLocations, configuredHospitals) {
  const countsByHospital = new Map((apiLocations || []).map((location) => [location.hospitalId, Number(location.patients || 0)]));
  const groups = new Map();
  for (const hospital of configuredHospitals || []) {
    if (!isValidIndiaCoordinate(hospital)) continue;
    const key = `${Number(hospital.latitude).toFixed(4)},${Number(hospital.longitude).toFixed(4)}`;
    const group = groups.get(key) || {
      latitude: Number(hospital.latitude),
      longitude: Number(hospital.longitude),
      city: hospital.city,
      state: hospital.state,
      hospitals: []
    };
    group.hospitals.push({
      id: hospital.id,
      name: hospital.name,
      patients: countsByHospital.get(hospital.id) || 0,
      coordinateStatus: hospital.coordinateStatus || "unverified"
    });
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function distanceBetweenPoints(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function buildMarkerLayouts(groups, projection) {
  const projectedGroups = groups
    .map((group) => {
      const point = projectIndiaCoordinate(projection, group.longitude, group.latitude);
      if (!point) return null;
      return { ...group, x: point[0], y: point[1], offsetX: 0, offsetY: 0 };
    })
    .filter(Boolean);
  const remaining = [...projectedGroups];
  const clusters = [];
  const clusterDistance = 30;

  while (remaining.length) {
    const cluster = [remaining.shift()];
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (cluster.some((item) => distanceBetweenPoints(item, remaining[i]) <= clusterDistance)) {
          cluster.push(remaining.splice(i, 1)[0]);
          changed = true;
        }
      }
    }
    clusters.push(cluster);
  }

  clusters.forEach((cluster) => {
    if (cluster.length === 1) return;
    const radius = cluster.length > 3 ? 18 : 14;
    cluster
      .sort((first, second) => first.y - second.y || first.x - second.x)
      .forEach((item, index) => {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / cluster.length;
        item.offsetX = Math.cos(angle) * radius;
        item.offsetY = Math.sin(angle) * radius;
      });
  });

  return projectedGroups;
}

async function renderPublicMap(locations) {
  const svg = document.getElementById("india-map");
  const markerLayer = document.getElementById("india-map-markers");
  if (!svg || !markerLayer) return;
  const statusTimer = window.setTimeout(() => {
    setPublicMapStatus("Loading India map…");
  }, 180);
  markerLayer.innerHTML = "";
  try {
    const { mapData, hospitals, projection } = await loadPublicMapAssets();
    window.clearTimeout(statusTimer);
    renderIndiaStates(mapData);
    const groups = buildHospitalLocationGroups(locations, hospitals);
    if (!groups.length) {
      setPublicMapStatus("Partner locations will appear here after verified coordinates are added.", "empty");
      return;
    }
    const markerLayouts = buildMarkerLayouts(groups, projection);
    markerLayouts.forEach((group) => {
      const hasOffset = Math.abs(group.offsetX) > 0.1 || Math.abs(group.offsetY) > 0.1;
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "g");
      marker.setAttribute("class", "india-hospital-marker");
      marker.setAttribute("tabindex", "0");
      marker.setAttribute("role", "button");
      marker.setAttribute("aria-label", `${group.city}, ${group.state}: ${group.hospitals.length} partner hospital${group.hospitals.length === 1 ? "" : "s"}`);
      marker.setAttribute("transform", `translate(${group.x.toFixed(2)} ${group.y.toFixed(2)})`);
      marker.innerHTML = `
        ${hasOffset ? `<line class="marker-leader" x1="0" y1="0" x2="${group.offsetX.toFixed(2)}" y2="${group.offsetY.toFixed(2)}"></line>` : ""}
        <g class="marker-pin" transform="translate(${group.offsetX.toFixed(2)} ${group.offsetY.toFixed(2)})">
          <circle class="marker-pulse" r="15"></circle>
          <circle class="marker-dot" r="${group.hospitals.length > 1 ? 8 : 6}"></circle>
          ${group.hospitals.length > 1 ? `<text class="marker-count" y="3">${group.hospitals.length}</text>` : ""}
        </g>
      `;
      marker.addEventListener("mouseenter", () => showPublicMapTooltip(group, marker));
      marker.addEventListener("mouseleave", hidePublicMapTooltip);
      marker.addEventListener("focus", () => showPublicMapTooltip(group, marker));
      marker.addEventListener("blur", hidePublicMapTooltip);
      marker.addEventListener("click", () => showPublicMapTooltip(group, marker));
      marker.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showPublicMapTooltip(group, marker);
        }
        if (event.key === "Escape") hidePublicMapTooltip();
      });
      markerLayer.appendChild(marker);
    });
    setPublicMapStatus("");
  } catch (err) {
    window.clearTimeout(statusTimer);
    setPublicMapStatus("Map data could not be loaded. Please refresh or contact the portal administrator.", "error");
  }
}

function getCachedPublicDashboardSummary() {
  try {
    const cached = JSON.parse(localStorage.getItem(PUBLIC_DASHBOARD_CACHE_KEY) || "null");
    return cached && cached.summary ? cached.summary : null;
  } catch {
    return null;
  }
}

function saveCachedPublicDashboardSummary(summary) {
  try {
    localStorage.setItem(PUBLIC_DASHBOARD_CACHE_KEY, JSON.stringify({
      cachedAt: new Date().toISOString(),
      summary
    }));
  } catch { /* localStorage can be unavailable in private browsing */ }
}

function applyPublicDashboardSummary(summary) {
  setPublicText("public-partner-hospitals", summary.partnerHospitals ?? 0);
  setPublicText("public-total-records", summary.totalRecords ?? 0);
  setPublicText("public-egfr-records", summary.egfrRecords ?? 0);
  setPublicText("public-kfre-records", summary.kfreRecords ?? 0);

  loadPublicMapAssets().then(({ hospitals }) => {
    const activeIds = new Set((summary.hospitalLocations || [])
      .filter((loc) => loc.patients > 0)
      .map((loc) => loc.hospitalId));
    const activeStates = new Set();
    (hospitals || []).forEach((h) => {
      if (activeIds.has(h.id) && h.state) {
        activeStates.add(h.state);
      }
    });
    setPublicText("public-active-states", activeStates.size);
  }).catch(() => {
    setPublicText("public-active-states", 0);
  });
  renderPublicBars("public-study-bars", [
    { label: "Ultrasound-based records", value: summary.egfrRecords || 0 },
    { label: "Clinical risk records", value: summary.kfreRecords || 0 }
  ]);
  renderPublicBars("public-ckd-bars", (summary.ckdDistribution || []).map((row) => ({
    label: row.label === "Yes" ? "Patients with CKD" : row.label === "No" ? "Normal kidney status" : row.label || "Unknown status",
    value: row.value || row.count || 0
  })));
  renderPublicMap(summary.hospitalLocations || []);
  renderPublicCharts(summary);
}

let pyramidChartInstance = null;
let ckdChartInstance = null;

function renderPublicCharts(summary) {
  if (typeof Chart === 'undefined') return;

  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.color = "#64748b";

  // Demographics (Age/Gender)
  const demographics = summary.demographics || [];
  const ageLabels = ['18-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80+'];
  const maleData = new Array(7).fill(0);
  const femaleData = new Array(7).fill(0);

  demographics.forEach((row) => {
    const idx = ageLabels.indexOf(row.age_group);
    if (idx !== -1) {
      if (row.sex === 'Male') maleData[idx] -= row.value; // Negative for pyramid
      else if (row.sex === 'Female') femaleData[idx] += row.value;
    }
  });

  const ctxPyramid = document.getElementById('chart-pyramid');
  if (ctxPyramid) {
    if (pyramidChartInstance) pyramidChartInstance.destroy();
    pyramidChartInstance = new Chart(ctxPyramid, {
      type: 'bar',
      data: {
        labels: ageLabels,
        datasets: [
          { label: 'Male', data: maleData, backgroundColor: '#3b82f6', borderRadius: 4 },
          { label: 'Female', data: femaleData, backgroundColor: '#a855f7', borderRadius: 4 }
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        scales: {
          x: { 
            stacked: true, 
            ticks: { callback: (value) => Math.abs(value) }, 
            grid: { display: false },
            title: { display: true, text: 'Number of Patients', font: { family: "'Inter', sans-serif", size: 12, weight: '600' }, color: '#64748b' }
          },
          y: { 
            stacked: true, 
            grid: { display: false },
            title: { display: true, text: 'Age Group (Years)', font: { family: "'Inter', sans-serif", size: 12, weight: '600' }, color: '#64748b' }
          }
        },
        plugins: { tooltip: { callbacks: { label: (ctx) => ctx.dataset.label + ': ' + Math.abs(ctx.raw) } } }
      }
    });
  }

  // CKD Status
  const ckdDist = summary.ckdDistribution || [];
  let normalCount = 0;
  let ckdCount = 0;
  ckdDist.forEach(row => {
    if (row.label === 'No' || row.label === 'Normal') normalCount += (row.value || row.count || 0);
    else if (row.label === 'Yes') ckdCount += (row.value || row.count || 0);
  });

  const ctxCkd = document.getElementById('chart-ckd-bar');
  if (ctxCkd) {
    if (ckdChartInstance) ckdChartInstance.destroy();
    ckdChartInstance = new Chart(ctxCkd, {
      type: 'bar',
      data: {
        labels: ['Normal Status', 'CKD Present'],
        datasets: [{
          data: [normalCount, ckdCount],
          backgroundColor: [
            'rgba(16, 185, 129, 0.8)',
            'rgba(239, 68, 68, 0.8)'
          ],
          borderColor: [
            'rgb(16, 185, 129)',
            'rgb(239, 68, 68)'
          ],
          borderWidth: 1,
          borderRadius: 6,
          barThickness: 40
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx) => ` ${ctx.raw.toLocaleString()} Patients` },
            padding: 12,
            titleFont: { size: 14, family: "'Inter', sans-serif" },
            bodyFont: { size: 13, family: "'Inter', sans-serif" }
          }
        },
        scales: {
          x: {
            grid: { display: true, color: '#e2e8f0', drawBorder: false },
            ticks: { font: { family: "'Inter', sans-serif" } },
            title: { display: true, text: 'Number of Patients', font: { family: "'Inter', sans-serif", size: 12, weight: '600' }, color: '#64748b' }
          },
          y: {
            grid: { display: false, drawBorder: false },
            ticks: { font: { family: "'Inter', sans-serif", weight: '600', size: 13 }, color: '#334155' }
          }
        }
      }
    });
  }
}

async function loadPublicDashboard() {
  const cachedSummary = getCachedPublicDashboardSummary();
  if (cachedSummary) {
    applyPublicDashboardSummary(cachedSummary);
  } else {
    renderPublicMap([]);
  }

  try {
    const response = await fetch("/api/public/dashboard", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to load public dashboard");
    const summary = result.summary || {};
    const isStaticFallback = summary.source === "static" && result.cache?.refreshing;
    if (!isStaticFallback || !cachedSummary) {
      applyPublicDashboardSummary(summary);
    }
    if (!isStaticFallback) {
      saveCachedPublicDashboardSummary(summary);
    }
    if (result.cache?.refreshing) {
      window.setTimeout(loadPublicDashboard, 2500);
    }
  } catch (err) {
    if (!cachedSummary) {
      renderPublicBars("public-study-bars", []);
      renderPublicBars("public-ckd-bars", []);
      renderPublicMap([]);
    }
  }
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
  showPublicScreen();
  loadPublicDashboard();
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
const publicLoginOpenBtn = document.getElementById("public-login-open");
const publicAnonymizationLoginBtn = document.getElementById("public-anonymization-login");
const openAnonymizationToolBtn = document.getElementById("open-anonymization-tool");
const loginBackPublicBtn = document.getElementById("login-back-public");
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
const anonymizationFolderInput = document.getElementById("anon-folder-input");
const anonymizationFileInput = document.getElementById("anon-file-input");
const anonymizationStatusCard = document.getElementById("anon-status-card");
const anonymizationPreviewGrid = document.getElementById("anon-preview-grid");
const anonymizationOriginalList = document.getElementById("anon-original-list");
const anonymizationOutputList = document.getElementById("anon-output-list");
const anonymizationApproveBtn = document.getElementById("anon-approve");
const anonymizationResetBtn = document.getElementById("anon-reset");
const anonymizationScreen = document.getElementById("anonymization-screen");
const anonymizationBackBtn = document.getElementById("anon-back-app");
const anonymizationPackageTile = document.querySelector(".anon-package-tile");

function isConsentConfirmed() {
  return state.studyFlow === "kfre"
    ? Boolean(kfreConsentCheckbox?.checked)
    : Boolean(consentCheckbox?.checked);
}

function applyStudyFlowUI() {
  const isKfre = state.studyFlow === "kfre";
  kfreOnlyMarkers.forEach((marker) => marker.classList.toggle("hidden", !isKfre));
  consentFlowPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.consentFlow !== state.studyFlow);
  });
  landingStudyEyebrow.textContent = isKfre ? "Kidney Failure Risk Equation Study" : "AI-Based eGFR Research Study";
  landingStudyDescription.textContent = isKfre
    ? "Collect patient-linked kidney-related clinical reports for KFRE recalibration and validation in a guided workflow."
    : "Collect patient-linked kidney ultrasound data, clinical reports, and intake details in one guided workflow.";
  workflowRecordsTitle.textContent = isKfre ? "KFRE Clinical Record" : "eGFR Package Upload";
  workflowRecordsSubtitle.textContent = isKfre ? "Clinical data + report" : "Package + findings";
  if (consentPageMeta) {
    consentPageMeta.textContent = isKfre
      ? "KFRE Study · Please verify the patient context before continuing"
      : "eGFR Study · Please verify the patient context before continuing";
  }
  questionnairePageMeta.textContent = isKfre ? "KFRE Research Data Collection Form" : "eGFR Research Data Collection Form";
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
  if (studyFlowSwitch) studyFlowSwitch.value = state.studyFlow;
  updateKfreQuestionnaireVisibility({ clearHidden: false });
  updateGeneratedStudyId();
  updateStudySpecificUploadVisibility();
  updateWorkflowAccess();
}

function getWorkflowAccess() {
  const patientReady = Boolean(hospitalIdInput?.value.trim() && uhidInput?.value.trim());
  return {
    consent: false,
    questionnaire: patientReady,
    egfr: patientReady && state.questionnaireCompleted
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
    ? "Complete patient setup to enter intake details."
    : "Complete the intake form to enter clinical record details.";
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
  setWorkflowNavState(questionnaireNav, questionnaireAccessBanner, access.questionnaire, "Data Collection Form");
  setWorkflowNavState(egfrNav, egfrAccessBanner, access.egfr, "eGFR Flow");

  document.getElementById("tab-consent")?.classList.toggle("preview-locked", !access.consent);
  [consentCheckbox, kfreConsentCheckbox].forEach((checkbox) => {
    if (checkbox) checkbox.disabled = !access.consent || Boolean(state.consentId);
  });
  if (consentContinueBtn && (!access.consent || state.consentId)) {
    consentContinueBtn.disabled = true;
  } else if (consentContinueBtn) {
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

function showAnonymizationWorkspace() {
  if (!state.authSession) {
    hideLoginError();
    showLoginScreen();
    return;
  }

  setMobileNavigationOpen(false);
  document.getElementById("public-screen")?.classList.add("hidden");
  loginScreen?.classList.add("hidden");
  appNavbar?.classList.add("hidden");
  document.querySelector(".app-container")?.classList.add("hidden");
  document.getElementById("intake-stepper")?.classList.add("hidden");
  hideAdminPortal();
  anonymizationScreen?.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function hideAnonymizationWorkspace() {
  anonymizationScreen?.classList.add("hidden");
  if (!state.authSession) {
    showPublicScreen();
    return;
  }
  showApp();
  updateWorkflowAccess();
}

function getAnonymizationCategory(file) {
  const pathText = `${file.webkitRelativePath || ""}/${file.name}`.toLowerCase();
  if (pathText.includes("left")) return { label: "Left kidney images", folder: "Left_Kidney_Images" };
  if (pathText.includes("right")) return { label: "Right kidney images", folder: "Right_Kidney_Images" };
  if (pathText.includes("lab")) return { label: "Lab reports", folder: "Lab_Reports" };
  if (pathText.includes("report") || pathText.includes("ultrasound")) return { label: "Ultrasound reports", folder: "Ultrasound_Reports" };
  return { label: "Needs review", folder: "Review_Required" };
}

function getFileExtension(name) {
  const match = String(name || "").match(/(\.[a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

function renderAnonymizationRows(files) {
  if (!anonymizationOriginalList || !anonymizationOutputList) return;
  anonymizationOriginalList.innerHTML = "";
  anonymizationOutputList.innerHTML = "";

  files.slice(0, 80).forEach((file, index) => {
    const category = getAnonymizationCategory(file);
    const extension = getFileExtension(file.name);
    const sourcePath = file.webkitRelativePath || file.name;
    const anonymizedName = `ANON-PATIENT-001_${String(index + 1).padStart(3, "0")}${extension}`;
    const anonymizedPath = `Anonymized_Patient_Folder/${category.folder}/${anonymizedName}`;

    anonymizationOriginalList.insertAdjacentHTML("beforeend", `
      <div class="anon-file-row">
        <span class="anon-check" aria-hidden="true">✓</span>
        <div>
          <strong>${escapeHTML(sourcePath)}</strong>
          <small>${escapeHTML(category.label)} · ${formatBytes(file.size || 0)}</small>
        </div>
      </div>
    `);
    anonymizationOutputList.insertAdjacentHTML("beforeend", `
      <div class="anon-file-row anonymized">
        <span class="anon-check" aria-hidden="true">✓</span>
        <div>
          <strong>${escapeHTML(anonymizedPath)}</strong>
          <small>Irreversible anonymized filename/path in demo preview</small>
        </div>
      </div>
    `);
  });

  if (files.length > 80) {
    const remaining = files.length - 80;
    const message = `<div class="anon-file-row"><span class="anon-check" aria-hidden="true">…</span><div><strong>${remaining} more file(s)</strong><small>Hidden from preview for readability.</small></div></div>`;
    anonymizationOriginalList.insertAdjacentHTML("beforeend", message);
    anonymizationOutputList.insertAdjacentHTML("beforeend", message);
  }
}

function updateAnonymizationDemo(files, modeLabel) {
  const selectedFiles = Array.from(files || []);
  const hasFiles = selectedFiles.length > 0;
  anonymizationPreviewGrid?.classList.toggle("hidden", !hasFiles);
  anonymizationPackageTile?.classList.toggle("tile-has-file", hasFiles);
  anonymizationStatusCard?.classList.toggle("has-file", hasFiles);
  if (anonymizationApproveBtn) anonymizationApproveBtn.disabled = !hasFiles;
  if (anonymizationResetBtn) anonymizationResetBtn.disabled = !hasFiles;

  if (!anonymizationStatusCard) return;
  if (!hasFiles) {
    anonymizationStatusCard.textContent = "No file selected";
    if (anonymizationOriginalList) anonymizationOriginalList.innerHTML = "";
    if (anonymizationOutputList) anonymizationOutputList.innerHTML = "";
    return;
  }

  const categories = selectedFiles.reduce((acc, file) => {
    const category = getAnonymizationCategory(file).label;
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  const categorySummary = Object.entries(categories)
    .map(([label, count]) => `${count} ${label}`)
    .join(" · ");
  anonymizationStatusCard.innerHTML = `
    <div class="file-preview-details">
      <span class="file-preview-name">
        <svg class="file-check-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="#14868c"/>
          <path d="M5 8.2l2.2 2.2L11 5.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        ${escapeHTML(modeLabel)} prepared for irreversible anonymization
      </span>
      <small>${selectedFiles.length} file(s) · ${escapeHTML(categorySummary)}</small>
    </div>
  `;
  renderAnonymizationRows(selectedFiles);
}

function clearAnonymizationDemo(message = "Temporary originals cleared from this browser demo.") {
  if (anonymizationFolderInput) anonymizationFolderInput.value = "";
  if (anonymizationFileInput) anonymizationFileInput.value = "";
  updateAnonymizationDemo([], "");
  if (anonymizationStatusCard) {
    anonymizationStatusCard.innerHTML = `
      <div class="file-preview-details">
        <strong>${escapeHTML(message)}</strong>
        <small>No files are retained by this frontend-only demonstration.</small>
      </div>
    `;
  }
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
const kfreQuestionnaireFields = document.querySelectorAll("[data-kfre-questionnaire]");
const kfreQuestionnaireRequiredChoices = document.querySelectorAll("[data-kfre-required-choice]");
const kfreQuestionnaireRequiredControls = document.querySelectorAll("[data-kfre-required-control]");
const questionnaireSection1Title = document.getElementById("questionnaire-section-1-title");
const ckdDurationInput = document.getElementById("ckd-duration");
const ckdStageInput = document.getElementById("ckd-stage");
const ckdStageBlock = document.getElementById("ckd-stage-block");
const ckdDurationBlock = document.getElementById("ckd-duration-block");
const ckdStageRemarksBlock = document.getElementById("ckd-stage-remarks-block");
const ckdStageRemarksInput = document.getElementById("ckd-stage-remarks");
const dialysisBlock = document.getElementById("dialysis-block");
const dialysisInput = document.getElementById("dialysis-yes-no");
const dialysisChoiceInputs = document.querySelectorAll("input[name='dialysisChoice']");
const dialysisFrequencyInput = document.getElementById("dialysis-frequency");
const dialysisFrequencyBlock = document.getElementById("dialysis-frequency-block");
const diabeticInput = document.getElementById("diabetic-yes-no");
const diabeticStageBlock = document.getElementById("diabetic-stage-block");
const diabeticStageInput = document.getElementById("diabetic-stage");
const diabetesDurationInput = document.getElementById("diabetes-duration");
const diabetesDurationBlock = document.getElementById("diabetes-duration-block");
const hypertensionInputs = document.querySelectorAll("input[name='hypertension']");
const hypertensionDurationInput = document.getElementById("hypertension-duration");
const hypertensionDurationBlock = document.getElementById("hypertension-duration-block");
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
const patientPackageFolderInput = document.getElementById("patient-package-folder");
const patientPackageTile = document.getElementById("patient-package-tile");
const patientPackagePreview = document.getElementById("patient-package-preview");
const ultrasoundVideoFileInput = document.getElementById("ultrasound-video-file");
const kfreClinicalDocumentInput = document.getElementById("kfre-clinical-document");
const kfreDocumentChoiceInputs = document.querySelectorAll("input[name='kfreDocumentAvailable']");
const kfreDocumentUpload = document.getElementById("kfre-document-upload");
const kfreLabPanel = document.getElementById("kfre-lab-panel");
const kfreLabAgeInput = document.getElementById("kfre-lab-age");
const kfreLabSexInput = document.getElementById("kfre-lab-sex");
const kfreEgfrInput = document.getElementById("kfre-egfr");
const kfreAcrInput = document.getElementById("kfre-acr");
const kfrePcrInput = document.getElementById("kfre-pcr");
const kfreSerumCalciumInput = document.getElementById("kfre-serum-calcium");
const kfreSerumPhosphateInput = document.getElementById("kfre-serum-phosphate");
const kfreSerumBicarbonateInput = document.getElementById("kfre-serum-bicarbonate");
const kfreSerumAlbuminInput = document.getElementById("kfre-serum-albumin");
const egfrUltrasoundSection = document.getElementById("egfr-ultrasound-section");
const egfrUploadMethodSection = document.getElementById("egfr-upload-method-section");
const egfrVideoSection = document.getElementById("egfr-video-section");
const kfreStructuredForm = document.getElementById("kfre-structured-form");
const kfreDocumentSection = document.getElementById("kfre-document-section");
const clinicalSubmitButton = document.getElementById("clinical-submit-button");
const egfrSubmitActions = document.getElementById("egfr-submit-actions");
const clinicalSubmitActions = document.getElementById("clinical-submit-actions");
const kfreSystolicBpInput = document.getElementById("kfre-systolic-bp");
const kfreDiastolicBpInput = document.getElementById("kfre-diastolic-bp");
const kfreHeartRateInput = document.getElementById("kfre-heart-rate");
// kfre-waist-hip-ratio replaced by separate waist/hip inputs (uncomment to revert)
// const kfreWaistHipRatioInput = document.getElementById("kfre-waist-hip-ratio");
const kfreWaistInput = document.getElementById("kfre-waist");
const kfreHipInput = document.getElementById("kfre-hip");
const kfreWhrDisplay = document.getElementById("kfre-whr-display");
// Follow-up status + fields removed (uncomment to revert)
// const kfreFollowupStatusInput = document.getElementById("kfre-followup-status");
// const kfreFollowupFields = document.getElementById("kfre-followup-fields");
// const kfreFollowupVisitInput = document.getElementById("kfre-followup-visit");
// const kfreFollowupMonthsInput = document.getElementById("kfre-followup-months");
// const kfreRepeatCreatinineInput = document.getElementById("kfre-repeat-creatinine");
// const kfreUpdatedEgfrInput = document.getElementById("kfre-updated-egfr");
// const kfreCkdProgressionInput = document.getElementById("kfre-ckd-progression");
const kfreHospitalizationInput = document.getElementById("kfre-hospitalization");
const kfreDialysisInitiatedInput = document.getElementById("kfre-dialysis-initiated");
const kfreTransplantInput = document.getElementById("kfre-transplant");
// kfre-outcome-ckd-stage removed (CKD stage captured in questionnaire — uncomment to revert)
// const kfreOutcomeCkdStageInput = document.getElementById("kfre-outcome-ckd-stage");
const kfreRapidProgressionInput = document.getElementById("kfre-rapid-progression");
const kfreKidneyFailureEventInput = document.getElementById("kfre-kidney-failure-event");
// Event date/type removed (uncomment to revert)
// const kfreKidneyFailureDetails = document.getElementById("kfre-kidney-failure-details");
// const kfreKidneyFailureDateInput = document.getElementById("kfre-kidney-failure-date");
// const kfreKidneyFailureTypeInput = document.getElementById("kfre-kidney-failure-type");
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

function setLandingEnrollmentDateToday() {
  if (landingEnrollmentDateInput) {
    landingEnrollmentDateInput.value = new Date().toISOString().slice(0, 10);
  }
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
  const supportedTab = ["landing", "questionnaire", "egfr"].includes(activeTab);
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
  return hospitalCode && patientCode ? `${hospitalCode}-${patientCode}` : "";
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
    showToast("Complete demo patient setup before using intake demo fill.");
    return;
  }

  setDemoValue(ageInput, "52");
  setDemoRadio("questionnaireSex", "Female");
  setDemoRadio("knownCkd", "Yes");
  setDemoValue(ckdStageInput, "2");
  updateDialysisVisibility();
  if (state.studyFlow === "kfre") {
    setDemoRadio("consentObtained", "Yes");
    setDemoValue(heightInput, "162");
    setDemoValue(weightInput, "64");
    setDemoValue(ethnicityInput, "Indian");
    setDemoValue(occupationInput, "Teacher");
    setDemoValue(ckdDurationInput, "2 years");
    setDemoValue(diabetesDurationInput, "6");
    setDemoValue(diabeticStageInput, "Type 2 diabetes");
    setDemoValue(hypertensionDurationInput, "4");
    setDemoRadio("cardiovascularDisease", "No");
    setDemoRadio("familyKidneyHistory", "No");
  }
  setDemoRadio("diabetesMellitus", "Yes");
  updateDiabeticVisibility();
  setDemoRadio("hypertension", "Yes");
  updateLinkedPatientSummary();
  updateQuestionnaireContinueState();
  showToast("Intake demo values filled. Confirm once, then continue.");
}

function fillDemoEgfrFlow() {
  if (egfrForm.classList.contains("preview-locked")) {
    showToast("Complete the intake form before using clinical demo fill.");
    return;
  }

  if (state.studyFlow === "kfre") {
    setDemoValue(kfreSystolicBpInput, "128");
    setDemoValue(kfreDiastolicBpInput, "82");
    setDemoValue(kfreHeartRateInput, "76");
    // kfreWaistHipRatioInput replaced by waist/hip (uncomment to revert)
    // setDemoValue(kfreWaistHipRatioInput, "0.91");
    if (kfreWaistInput) { kfreWaistInput.value = "88"; kfreWaistInput.dispatchEvent(new Event("input")); }
    if (kfreHipInput)   { kfreHipInput.value = "97";  kfreHipInput.dispatchEvent(new Event("input")); }
    // kfreFollowupStatusInput removed (uncomment to revert)
    // setDemoValue(kfreFollowupStatusInput, "None");
    updateKfreConditionalFields({ clearHidden: true });
    // kfreOutcomeCkdStageInput removed (uncomment to revert)
    // setDemoValue(kfreOutcomeCkdStageInput, "2");
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
  else if (activeTab === "questionnaire") fillDemoQuestionnaire();
  else if (activeTab === "egfr") fillDemoEgfrFlow();
  else showToast("Demo auto-fill is available on intake pages only.");
  updateDemoAutofillVisibility();
}

function getCheckedValue(inputs) {
  return Array.from(inputs).find((input) => input.checked)?.value || "";
}

let latestDialysisChoice = "";

function rememberDialysisChoice(value) {
  latestDialysisChoice = value || "";
  if (dialysisInput) dialysisInput.value = latestDialysisChoice;
}

function syncDialysisValue() {
  const selectedDialysis = Array.from(dialysisChoiceInputs).find((input) => input.checked);
  const formDialysisValue = questionnaireForm ? new FormData(questionnaireForm).get("dialysisChoice") : "";
  const dialysisValue = selectedDialysis?.value || formDialysisValue || latestDialysisChoice || dialysisInput?.value || "";
  rememberDialysisChoice(dialysisValue);
  return dialysisValue;
}

function getDialysisValue() {
  return syncDialysisValue();
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
      if (input === landingUhidInput) {
        updateGeneratedStudyId();
        updateStartIntakeState();
      }
    });
  });

  [landingEnrollmentDateInput, enrollmentDateInput]
    .filter(Boolean)
    .forEach((input) => {
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
  linkedCkd.textContent = getCheckedValue(knownCkdInputs) || "--";
  linkedDiabetic.textContent = diabeticInput.value || "--";
  syncKfreLabDemographics();
}

function updateConsentContext() {
  if (!consentContextPatient || !consentContextHospital || !consentContextHospitalId || !consentContextUhid || !consentContextDate) return;
  const selectedHospital = getSelectableIntakeSources().find((hospital) => hospital.id === hospitalNameInput.value);
  const hospitalName = selectedHospital?.name || "--";
  const patientId = uhidInput.value.trim() || "--";

  consentContextPatient.textContent = patientId === "--" ? "No patient selected" : `Patient ${patientId}`;
  consentContextHospital.textContent = hospitalName;
  consentContextHospitalId.textContent = hospitalIdInput.value || "--";
  consentContextUhid.textContent = patientId;
  const enrollmentValue = enrollmentDateInput?.value || landingEnrollmentDateInput?.value || "";
  consentContextDate.textContent = formatDisplayDate(enrollmentValue);
}

function syncIntakeToQuestionnaire() {
  updateGeneratedStudyId();
  hospitalNameInput.value = landingHospitalInput.value;
  studyIdInput.value = "";
  hospitalIdInput.value = landingHospitalIdInput.value;
  uhidInput.value = landingUhidInput.value.trim();
  if (enrollmentDateInput) {
    enrollmentDateInput.value = landingEnrollmentDateInput.value;
  }
  updateConsentContext();
  updateLinkedPatientSummary();
}

function switchStudyFlow(nextFlow, { skipConfirm = false } = {}) {
  const normalized = nextFlow === "kfre" ? "kfre" : "egfr";
  if (normalized === state.studyFlow) {
    if (studyFlowSwitch) studyFlowSwitch.value = normalized;
    return;
  }

  const hasInProgressPatient = Boolean(
    uhidInput?.value.trim() ||
    ageInput?.value.trim() ||
    (Array.isArray(state.pendingSubmission?.uploadFiles) && state.pendingSubmission.uploadFiles.length)
  );
  if (!skipConfirm && hasInProgressPatient) {
    const proceed = window.confirm("Switching the study pathway will clear the current in-progress patient entry. Continue?");
    if (!proceed) {
      if (studyFlowSwitch) studyFlowSwitch.value = state.studyFlow;
      return;
    }
  }

  state.studyFlow = normalized;
  state.hospitalDashboardView = normalized;
  saveStudyFlow(normalized);
  closeReviewSubmission();
  resetEgfrForm();
  resetPatientIntakeForNextRecord();
  applyStudyFlowUI();
  activateTab("landing");
  if (studyFlowSwitch) studyFlowSwitch.value = normalized;
  showToast(`Switched to ${normalized === "kfre" ? "KFRE" : "eGFR"} study flow.`);
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

const zipCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

let preparedPatientPackageFile = null;
let patientPackageSourceFiles = [];
let patientPackageSourceKind = null;
let patientPackageIsPreparing = false;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = zipCrcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function createZipHeader(length) {
  return new Uint8Array(length);
}

function sanitizeZipPath(value) {
  return (value || "upload")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/") || "upload";
}

function uniqueZipEntries(files) {
  const used = new Map();
  return files.map((file) => {
    const rawPath = sanitizeZipPath(file.webkitRelativePath || file.name || "upload");
    const count = used.get(rawPath) || 0;
    used.set(rawPath, count + 1);
    if (!count) return { file, path: rawPath };
    const dotIndex = rawPath.lastIndexOf(".");
    const nextPath = dotIndex > 0
      ? `${rawPath.slice(0, dotIndex)}-${count + 1}${rawPath.slice(dotIndex)}`
      : `${rawPath}-${count + 1}`;
    return { file, path: nextPath };
  });
}

async function createZipPackage(files, zipName) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of uniqueZipEntries(files)) {
    const data = new Uint8Array(await entry.file.arrayBuffer());
    const nameBytes = encoder.encode(entry.path);
    const checksum = crc32(data);
    const { dosTime, dosDate } = dosDateTime(entry.file.lastModified ? new Date(entry.file.lastModified) : new Date());

    const localHeader = createZipHeader(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, dosTime);
    writeUint16(localView, 12, dosDate);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, data.length);
    writeUint32(localView, 22, data.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = createZipHeader(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, dosTime);
    writeUint16(centralView, 14, dosDate);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, data.length);
    writeUint32(centralView, 24, data.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endHeader = createZipHeader(22);
  const endView = new DataView(endHeader.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  return new File([...localParts, ...centralParts, endHeader], zipName, { type: "application/zip" });
}

function getPackageSourceKind(files) {
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) return "zip";
  if (files.some((file) => file.webkitRelativePath)) return "folder";
  return files.length === 1 ? "file" : "files";
}

function packageZipName() {
  const patientRef = (uhidInput.value || landingUhidInput.value || generateStudyId(hospitalIdInput.value, uhidInput.value) || "patient-package")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${patientRef || "patient-package"}.zip`;
}

function getTotalFileSize(files) {
  return Array.from(files || []).reduce((sum, file) => sum + Number(file.size || 0), 0);
}

function isOversizedUpload(file) {
  return file && Number(file.size || 0) > MAX_UPLOAD_FILE_BYTES;
}

function getOversizedUploadMessage(file, label = "Selected upload") {
  return `${label} is ${formatBytes(file.size)}. Maximum allowed size is ${MAX_UPLOAD_FILE_LABEL}.`;
}

function renderPatientPackagePreview({ status, files = [], packageFile = null, loading = false }) {
  if (!patientPackagePreview || !patientPackageTile) return;
  patientPackagePreview.innerHTML = "";
  patientPackagePreview.classList.toggle("has-file", Boolean(packageFile || files.length));
  patientPackageTile.classList.toggle("tile-loading", loading);
  patientPackageTile.classList.toggle("tile-has-file", Boolean(packageFile));

  if (!packageFile && !files.length) {
    patientPackagePreview.textContent = status || "No file selected";
    return;
  }

  const visibleFiles = files.slice(0, 12);
  const remaining = Math.max(files.length - visibleFiles.length, 0);
  const listItems = visibleFiles.map((file) => `
    <li>
      <svg class="file-check-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="#14868c"/>
        <path d="M5 8.2l2.2 2.2L11 5.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>${escapeHTML(file.webkitRelativePath || file.name)}</span>
    </li>
  `).join("");

  patientPackagePreview.innerHTML = `
    <div class="file-preview-details">
      <strong class="package-upload-status">${escapeHTML(status)}</strong>
      ${packageFile ? `<small>Prepared package: ${escapeHTML(packageFile.name)} · ${formatBytes(packageFile.size)}</small>` : "<small>Preparing ZIP package…</small>"}
      <ul class="package-file-list">${listItems}${remaining ? `<li>+ ${remaining} more file(s)</li>` : ""}</ul>
    </div>
  `;
}

async function preparePatientPackage(files) {
  const selectedFiles = Array.from(files || []).filter((file) => file.size >= 0);
  const totalSelectedBytes = getTotalFileSize(selectedFiles);
  preparedPatientPackageFile = null;
  patientPackageSourceFiles = selectedFiles;
  patientPackageSourceKind = getPackageSourceKind(selectedFiles);
  patientPackageIsPreparing = false;

  if (!selectedFiles.length) {
    renderPatientPackagePreview({ status: "", files: [] });
    return;
  }

  if (totalSelectedBytes > MAX_UPLOAD_FILE_BYTES) {
    const message = `Selected patient package is ${formatBytes(totalSelectedBytes)}. Maximum allowed size is ${MAX_UPLOAD_FILE_LABEL}.`;
    patientPackageSourceFiles = [];
    patientPackageSourceKind = null;
    if (patientPackageFileInput) patientPackageFileInput.value = "";
    if (patientPackageFolderInput) patientPackageFolderInput.value = "";
    renderPatientPackagePreview({ status: message, files: [] });
    showToast(message);
    return;
  }

  const status = patientPackageSourceKind === "folder"
    ? `Folder with ${selectedFiles.length} file(s) got uploaded`
    : patientPackageSourceKind === "files"
      ? `${selectedFiles.length} file(s) got uploaded`
      : "File is uploaded";

  renderPatientPackagePreview({ status, files: selectedFiles, loading: patientPackageSourceKind !== "zip" });

  try {
    patientPackageIsPreparing = patientPackageSourceKind !== "zip";
    preparedPatientPackageFile = patientPackageSourceKind === "zip"
      ? (selectedFiles[0].type ? selectedFiles[0] : new File([selectedFiles[0]], selectedFiles[0].name, { type: "application/zip", lastModified: selectedFiles[0].lastModified }))
      : await createZipPackage(selectedFiles, packageZipName());
    if (isOversizedUpload(preparedPatientPackageFile)) {
      throw new Error(getOversizedUploadMessage(preparedPatientPackageFile, "Prepared patient package"));
    }
    renderPatientPackagePreview({ status, files: selectedFiles, packageFile: preparedPatientPackageFile });
    showToast(`✓ ${status}`);
  } catch (err) {
    preparedPatientPackageFile = null;
    renderPatientPackagePreview({ status: err.message || "Could not prepare ZIP package. Please try again.", files: selectedFiles });
    showToast(err.message || "Could not prepare ZIP package. Please try again.");
  } finally {
    patientPackageIsPreparing = false;
    patientPackageTile?.classList.remove("tile-loading");
  }
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

  if (isOversizedUpload(file)) {
    const message = getOversizedUploadMessage(file, file.name || "Selected file");
    input.value = "";
    preview.textContent = message;
    showToast(message);
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
  preparedPatientPackageFile = null;
  patientPackageSourceFiles = [];
  patientPackageSourceKind = null;
  patientPackageIsPreparing = false;
  if (patientPackageFileInput) patientPackageFileInput.value = "";
  if (patientPackageFolderInput) patientPackageFolderInput.value = "";
  patientPackageTile?.classList.remove("tile-has-file", "tile-loading");
}

let filePreviewsInitialized = false;
function initializeFilePreviews() {
  if (filePreviewsInitialized) return;
  filePreviewsInitialized = true;
  [
    [leftKidneyFileInput, "leftKidney"],
    [rightKidneyFileInput, "rightKidney"],
    [egfrReportInput, "egfrReport"],
    [ultrasoundVideoFileInput, "ultrasoundVideo"],
    [kfreClinicalDocumentInput, "clinicalDocument"]
  ].filter(([input]) => input).forEach(([input, fieldName]) => {
    renderFilePreview(input, fieldName);
    input.addEventListener("change", () => renderFilePreview(input, fieldName));
  });
  patientPackageFileInput?.addEventListener("change", () => {
    if (patientPackageFolderInput) patientPackageFolderInput.value = "";
    preparePatientPackage(patientPackageFileInput.files);
  });
  patientPackageFolderInput?.addEventListener("change", () => {
    if (patientPackageFileInput) patientPackageFileInput.value = "";
    preparePatientPackage(patientPackageFolderInput.files);
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

publicLoginOpenBtn?.addEventListener("click", () => {
  pendingAnonymizationOpen = false;
  hideLoginError();
  showLoginScreen();
});

publicAnonymizationLoginBtn?.addEventListener("click", () => {
  if (state.authSession) {
    showAnonymizationWorkspace();
    return;
  }
  pendingAnonymizationOpen = true;
  hideLoginError();
  showLoginScreen();
});

loginBackPublicBtn?.addEventListener("click", () => {
  pendingAnonymizationOpen = false;
  hideLoginError();
  showPublicScreen();
  loadPublicDashboard();
});

openAnonymizationToolBtn?.addEventListener("click", showAnonymizationWorkspace);
anonymizationBackBtn?.addEventListener("click", hideAnonymizationWorkspace);

tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

syncChoiceInputs.forEach((input) => {
  input.addEventListener("change", () => {
    syncChoiceValue(input);
    if (["diabetesMellitus", "hypertension"].includes(input.name)) {
      updateDiabeticVisibility();
    }
    if (input.name === "dialysisChoice") {
      rememberDialysisChoice(input.value);
      updateKfreQuestionnaireVisibility({ clearHidden: false });
    }
    updateQuestionnaireContinueState();
  });
});

dialysisChoiceInputs.forEach((input) => {
  input.addEventListener("click", () => {
    rememberDialysisChoice(input.value);
    updateQuestionnaireContinueState();
  });
  input.addEventListener("input", () => {
    rememberDialysisChoice(input.value);
    updateQuestionnaireContinueState();
  });
});

hypertensionInputs.forEach((input) => {
  input.addEventListener("change", () => {
    updateDiabeticVisibility();
    updateQuestionnaireContinueState();
  });
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
const TAB_TO_STEP = { landing: 1, questionnaire: 2, egfr: 3 };
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
  const stepAccess = { 1: true, 2: access.questionnaire, 3: access.egfr };
  const completed = { 1: access.questionnaire, 2: access.egfr, 3: false };

  [1, 2, 3].forEach((n) => {
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

consentCheckbox?.addEventListener("change", () => {
  if (!state.consentId && getWorkflowAccess().consent) {
    consentContinueBtn.textContent = "Accept & Continue";
    consentContinueBtn.disabled = !isConsentConfirmed();
  }
});
kfreConsentCheckbox?.addEventListener("change", () => {
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
  setLandingEnrollmentDateToday();
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
  updateStartIntakeState();
});

hospitalSessionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  updateLandingHospitalId();
  if (saveHospitalSession()) {
    updateGeneratedStudyId();
    setLandingEnrollmentDateToday();
    landingUhidInput.focus();
    updateStartIntakeState();
  }
});

function handlePatientStart() {
  updateLandingHospitalId();
  setLandingEnrollmentDateToday();
  if (!state.hospitalSession) {
    if (!saveHospitalSession()) {
      landingHospitalInput.focus();
      return false;
    }
  }

  if (!landingUhidInput.value.trim()) {
    showToast("Enter Patient Unique ID before continuing.");
    landingUhidInput.focus();
    return false;
  }

  updateGeneratedStudyId();

  if (!validateDateInput(landingEnrollmentDateInput)) {
    landingEnrollmentDateInput.reportValidity();
    return false;
  }

  syncIntakeToQuestionnaire();
  resetConsentRecord();
  state.questionnaireCompleted = false;
  state.currentUploadSession = null;
  if (consentCheckbox) consentCheckbox.checked = false;
  if (kfreConsentCheckbox) kfreConsentCheckbox.checked = false;
  if (consentContinueBtn) consentContinueBtn.disabled = true;
  updateWorkflowAccess();
  activateTab("questionnaire");
  window.scrollTo({ top: 0, behavior: "smooth" });
  return true;
}

function updateStartIntakeState() {
  if (!startPatientConsentBtn) return;
  const hasHospital = Boolean(landingHospitalInput?.value);
  const hasPatientId = Boolean(landingUhidInput?.value.trim());
  startPatientConsentBtn.disabled = !(hasHospital && hasPatientId);
}

patientStartForm.addEventListener("submit", (event) => {
  event.preventDefault();
  handlePatientStart();
});

startPatientConsentBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  handlePatientStart();
});

consentContinueBtn?.addEventListener("click", async () => {
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

function setRadioGroupRequired(groupName, required) {
  document.querySelectorAll(`input[name='${groupName}']`).forEach((input) => {
    input.required = required;
  });
}

function setControlRequired(controlId, required) {
  const control = document.getElementById(controlId);
  if (control) control.required = required;
}

function updateKfreQuestionnaireVisibility({ clearHidden = false } = {}) {
  const isKfre = state.studyFlow === "kfre";
  const knownCkd = getCheckedValue(knownCkdInputs);
  const dialysisValue = getDialysisValue();
  const showCkdDetails = isKfre && knownCkd === "Yes";
  const showDialysisDetails = showCkdDetails && ["3a", "3b", "4", "5"].includes(ckdStageInput.value);
  const showDialysisFrequency = showDialysisDetails && dialysisValue === "Yes";
  const showOtherCkdRemarks = showCkdDetails && ckdStageInput.value === "Other";

  if (questionnaireSection1Title) {
    questionnaireSection1Title.textContent = "Patient Identification & Study Details";
  }

  kfreQuestionnaireFields.forEach((field) => {
    field.classList.toggle("hidden", !isKfre);
  });
  if (ckdStageBlock) ckdStageBlock.classList.toggle("hidden", !showCkdDetails);
  if (ckdDurationBlock) ckdDurationBlock.classList.toggle("hidden", !showCkdDetails);
  dialysisBlock.classList.toggle("hidden", !showDialysisDetails);
  dialysisFrequencyBlock?.classList.toggle("hidden", !showDialysisFrequency);
  // ckdStageRemarksBlock removed (Other option removed — uncomment to revert)
  // ckdStageRemarksBlock?.classList.toggle("hidden", !showOtherCkdRemarks);

  kfreQuestionnaireRequiredChoices.forEach((field) => {
    setRadioGroupRequired(field.dataset.kfreRequiredChoice, isKfre);
  });
  kfreQuestionnaireRequiredControls.forEach((field) => {
    setControlRequired(field.dataset.kfreRequiredControl, isKfre);
  });
  ckdStageInput.required = showCkdDetails;
  // ckdStageRemarksInput removed (Other option removed — uncomment to revert)
  // if (ckdStageRemarksInput) ckdStageRemarksInput.required = showOtherCkdRemarks;
  dialysisInput.required = false;
  dialysisInput.value = dialysisValue;
  ckdDurationInput.required = false;
  ckdDurationInput.setCustomValidity("");
  dialysisFrequencyInput.required = showDialysisFrequency;
  dialysisFrequencyInput.disabled = !showDialysisFrequency;
  if (!showDialysisFrequency) dialysisFrequencyInput.value = "";

  if (knownCkd !== "Yes" || !isKfre) {
    ckdStageInput.value = "";
    ckdDurationInput.value = "";
    // if (ckdStageRemarksInput) ckdStageRemarksInput.value = "";  // uncomment to revert
  }
  if (!showDialysisDetails) {
    rememberDialysisChoice("");
    dialysisFrequencyInput.value = "";
    dialysisChoiceInputs.forEach((input) => {
      input.checked = false;
      input.required = false;
    });
  } else {
    dialysisChoiceInputs.forEach((input) => {
      input.required = false;
    });
  }
  // if (!showOtherCkdRemarks && ckdStageRemarksInput) ckdStageRemarksInput.value = "";  // uncomment to revert
  if (clearHidden && !isKfre) {
    kfreQuestionnaireFields.forEach((field) => clearControlsInPanel(field));
  }

  updateQuestionnaireBmi();
  updateDiabeticVisibility();
}

function isQuestionnaireReadyForClinicalFlow() {
  const isKfre = state.studyFlow === "kfre";
  const knownCkd = getCheckedValue(knownCkdInputs);
  const height = Number(heightInput.value);
  const weight = Number(weightInput.value);
  const dialysisValue = getDialysisValue();
  return Boolean(
    hospitalIdInput.value &&
    uhidInput.value.trim() &&
    ageInput.value.trim() &&
    Number(ageInput.value) >= 18 &&
    Number(ageInput.value) <= 120 &&
    sexInput.value &&
    knownCkd &&
    diabeticInput.value &&
    getCheckedValue(hypertensionInputs) &&
    (!isKfre || (
      // getCheckedValue(consentObtainedInputs) &&  // Consent Obtained removed from intake (uncomment to revert)
      Number.isFinite(height) && height >= 50 && height <= 250 &&
      Number.isFinite(weight) && weight >= 10 && weight <= 400 &&
      (knownCkd !== "Yes" || (
        ckdStageInput.value &&
        (ckdStageInput.value !== "Other" || ckdStageRemarksInput?.value.trim()) &&
        (dialysisValue !== "Yes" || dialysisFrequencyInput.value.trim())
      ))
    ))
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

  const numericInputs = state.studyFlow === "kfre"
    ? [ageInput, heightInput, weightInput, dialysisFrequencyInput, diabetesDurationInput, hypertensionDurationInput]
    : [ageInput];
  if (!numericInputs.filter((input) => input.value.trim()).every(validateNumericInput)) {
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

  if (!getCheckedValue(knownCkdInputs)) {
    showToast("Select Chronic Kidney Disease (CKD) status.");
    return false;
  }

  if (state.studyFlow === "kfre") {
    const dialysisValue = getDialysisValue();
    // Consent Obtained removed from intake (uncomment to revert)
    // if (!getCheckedValue(consentObtainedInputs)) {
    //   showToast("Select whether patient consent was obtained.");
    //   return false;
    // }
    if (!heightInput.value.trim() || !weightInput.value.trim()) {
      showToast("Enter height and weight for the KFRE questionnaire.");
      return false;
    }
    if (getCheckedValue(knownCkdInputs) === "Yes" && !ckdStageInput.value) {
      showToast("Select CKD stage for the KFRE questionnaire.");
      return false;
    }
    // ckdStageRemarks removed (Other option removed — uncomment to revert)
    // if (ckdStageInput.value === "Other" && !ckdStageRemarksInput.value.trim()) {
    //   showToast("Enter CKD stage remarks for Other.");
    //   return false;
    // }
    if (dialysisValue === "Yes" && !dialysisFrequencyInput.value.trim()) {
      showToast("Enter dialysis frequency.");
      return false;
    }
  }

  if (!diabeticInput.value) {
    showToast("Select diabetes status.");
    return false;
  }

  if (!getCheckedValue(hypertensionInputs)) {
    showToast("Select hypertension status.");
    return false;
  }

  return true;
}

questionnaireHeightInput?.addEventListener("input", updateQuestionnaireBmi);
questionnaireWeightInput?.addEventListener("input", updateQuestionnaireBmi);
questionnaireForm?.addEventListener("input", updateQuestionnaireContinueState);
questionnaireForm?.addEventListener("change", updateQuestionnaireContinueState);
questionnaireContinueBtn?.addEventListener("click", () => {
  syncDialysisValue();
  updateKfreQuestionnaireVisibility({ clearHidden: false });
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

hospitalNameInput?.addEventListener("change", updateHospitalId);
[studyIdInput, uhidInput, enrollmentDateInput, ageInput, sexInput, weightInput, ckdStageInput, ckdStageRemarksInput, diabeticInput]
  .filter(Boolean)
  .forEach((input) => {
    input.addEventListener("input", updateLinkedPatientSummary);
    input.addEventListener("change", updateLinkedPatientSummary);
  });
[...knownCkdInputs, ...hypertensionInputs].filter(Boolean).forEach((input) => {
  input.addEventListener("change", updateLinkedPatientSummary);
});

enrollmentDateInput?.addEventListener("change", updateConsentContext);

function getUploadMode() {
  if (state.studyFlow === "kfre") {
    return "clinical_document";
  }
  return "package";
}

function updateStudySpecificUploadVisibility() {
  const isKfre = state.studyFlow === "kfre";
  [egfrUltrasoundSection, packageUploadSection, egfrVideoSection]
    .forEach((section) => section?.classList.toggle("hidden", isKfre));
  packageUploadSection?.classList.toggle("flow-hidden", isKfre);
  [egfrUploadMethodSection, separateUploadSection].forEach((section) => section?.classList.add("hidden"));
  kfreStructuredForm?.classList.toggle("hidden", !isKfre);
  kfreDocumentSection?.classList.toggle("hidden", !isKfre);
  kfreDocumentSection?.classList.toggle("flow-hidden", !isKfre);
  egfrSubmitActions?.classList.toggle("hidden", isKfre);
  clinicalSubmitActions?.classList.toggle("hidden", !isKfre);
  updateKfreDocumentAvailability({ clearHidden: true });
  if (clinicalSubmitButton) clinicalSubmitButton.textContent = "Submit KFRE Record";
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

function getKfreDocumentAvailability() {
  return document.querySelector("input[name='kfreDocumentAvailable']:checked")?.value || "Yes";
}

function syncKfreLabDemographics() {
  if (!kfreLabAgeInput || !kfreLabSexInput) return;
  const ageValue = ageInput?.value.trim() || "";
  if (ageValue) {
    kfreLabAgeInput.value = ageValue;
    kfreLabAgeInput.readOnly = true;
  } else {
    kfreLabAgeInput.readOnly = false;
  }
  const sexValue = sexInput?.value || "";
  if (sexValue === "Male" || sexValue === "Female") {
    kfreLabSexInput.value = sexValue;
    kfreLabSexInput.disabled = true;
  } else {
    if (!kfreLabSexInput.disabled) kfreLabSexInput.value = kfreLabSexInput.value || "";
    kfreLabSexInput.disabled = false;
  }
}

function updateKfreDocumentAvailability({ clearHidden = false } = {}) {
  const isKfre = state.studyFlow === "kfre";
  const hasDocument = getKfreDocumentAvailability() !== "No";
  const showUpload = isKfre && hasDocument;
  const showLabs = isKfre && !hasDocument;

  kfreDocumentUpload?.classList.toggle("hidden", !showUpload);
  kfreDocumentUpload?.classList.toggle("flow-hidden", !showUpload);
  kfreLabPanel?.classList.toggle("hidden", !showLabs);
  kfreLabPanel?.classList.toggle("flow-hidden", !showLabs);

  if (kfreClinicalDocumentInput) {
    kfreClinicalDocumentInput.required = showUpload;
  }

  const requireLabs = showLabs;
  if (kfreLabAgeInput) kfreLabAgeInput.required = requireLabs;
  if (kfreLabSexInput) kfreLabSexInput.required = requireLabs;
  if (kfreEgfrInput) kfreEgfrInput.required = requireLabs;
  if (kfreAcrInput) kfreAcrInput.required = false;
  if (kfrePcrInput) kfrePcrInput.required = requireLabs;
  [kfreSerumCalciumInput, kfreSerumPhosphateInput, kfreSerumBicarbonateInput, kfreSerumAlbuminInput]
    .filter(Boolean)
    .forEach((input) => { input.required = false; });

  if (clearHidden && showUpload && kfreLabPanel) {
    clearControlsInPanel(kfreLabPanel);
  }
  if (clearHidden && showLabs && kfreClinicalDocumentInput) {
    kfreClinicalDocumentInput.value = "";
    renderFilePreview(kfreClinicalDocumentInput, "clinicalDocument");
  }

  syncKfreLabDemographics();
}

function clearControlsInPanel(panel) {
  panel?.querySelectorAll("input, select").forEach((input) => {
    input.value = "";
  });
}

function updateKfreConditionalFields({ clearHidden = false } = {}) {
  const isKfre = state.studyFlow === "kfre";
  // kfreWaistHipRatioInput replaced by kfreWaistInput/kfreHipInput (uncomment old line to revert)
  // const alwaysRequired = [kfreSystolicBpInput, kfreDiastolicBpInput, kfreHeartRateInput, kfreWaistHipRatioInput, kfreOutcomeCkdStageInput, kfreRapidProgressionInput, kfreKidneyFailureEventInput];
  const alwaysRequired = [
    kfreSystolicBpInput, kfreDiastolicBpInput, kfreHeartRateInput,
    kfreWaistInput, kfreHipInput,
    kfreRapidProgressionInput, kfreKidneyFailureEventInput,
    kfreHospitalizationInput, kfreDialysisInitiatedInput, kfreTransplantInput
  ];
  alwaysRequired.filter(Boolean).forEach((input) => { input.required = isKfre; });

  // Follow-up conditional fields removed (uncomment block to revert)
  // const followupAvailable = isKfre && kfreFollowupStatusInput.value === "Available";
  // const followupRequired = [kfreFollowupVisitInput, kfreFollowupMonthsInput, kfreRepeatCreatinineInput, kfreUpdatedEgfrInput, kfreCkdProgressionInput, kfreHospitalizationInput, kfreDialysisInitiatedInput, kfreTransplantInput];
  // followupRequired.forEach((input) => { input.required = followupAvailable; });
  // kfreFollowupFields.classList.toggle("hidden", !followupAvailable);
  // if (clearHidden && !followupAvailable) clearControlsInPanel(kfreFollowupFields);

  // Event date/type removed (uncomment to revert)
  // const kidneyFailureRecorded = isKfre && kfreKidneyFailureEventInput.value === "Yes";
  // kfreKidneyFailureDateInput.required = kidneyFailureRecorded;
  // kfreKidneyFailureTypeInput.required = kidneyFailureRecorded;
  // kfreKidneyFailureDetails.classList.toggle("hidden", !kidneyFailureRecorded);
  // if (clearHidden && !kidneyFailureRecorded) clearControlsInPanel(kfreKidneyFailureDetails);
}

function updateUploadModeVisibility() {
  if (state.studyFlow === "kfre") {
    return;
  }
  const mode = getUploadMode();
  separateUploadSection?.classList.add("hidden");
  packageUploadSection?.classList.remove("hidden");

  if (leftKidneyFileInput)  { leftKidneyFileInput.required  = false; leftKidneyFileInput.value  = ""; }
  if (rightKidneyFileInput) { rightKidneyFileInput.required = false; rightKidneyFileInput.value = ""; }
  if (egfrReportInput)      { egfrReportInput.required      = false; egfrReportInput.value      = ""; }
  if (patientPackageFileInput)  patientPackageFileInput.required  = false;
  if (patientPackageFolderInput) patientPackageFolderInput.required = false;

  uploadModeCards.forEach((card) => {
    card.classList.toggle("selected", card.dataset.uploadModeCard === mode);
  });
}

uploadModeInputs.forEach((input) => {
  input.addEventListener("change", updateUploadModeVisibility);
});
kfreDocumentChoiceInputs.forEach((input) => {
  input.addEventListener("change", () => updateKfreDocumentAvailability({ clearHidden: true }));
});
demoAutofillBtn?.addEventListener("click", fillCurrentDemoPage);
// kfreFollowupStatusInput removed (uncomment to revert)
// kfreFollowupStatusInput.addEventListener("change", () => updateKfreConditionalFields({ clearHidden: true }));
kfreKidneyFailureEventInput.addEventListener("change", () => updateKfreConditionalFields({ clearHidden: true }));
// kfreKidneyFailureDateInput removed (uncomment to revert)
// kfreKidneyFailureDateInput.addEventListener("change", () => validateDateInput(kfreKidneyFailureDateInput));

// Waist-Hip Ratio auto-calculation from individual measurements
function updateKfreWhr() {
  const waist = parseFloat(kfreWaistInput?.value);
  const hip   = parseFloat(kfreHipInput?.value);
  if (kfreWhrDisplay) {
    kfreWhrDisplay.value = (waist > 0 && hip > 0) ? (waist / hip).toFixed(2) : "";
  }
}
kfreWaistInput?.addEventListener("input", updateKfreWhr);
kfreHipInput?.addEventListener("input", updateKfreWhr);
updateKfreWhr();

function updateDialysisVisibility() {
  updateKfreQuestionnaireVisibility({ clearHidden: true });
  updateLinkedPatientSummary();
}

function updateDiabeticVisibility() {
  // diabeticStageBlock removed from KFRE intake (uncomment to revert)
  // const showClassification = state.studyFlow === "kfre" && diabeticInput.value === "Yes";
  // diabeticStageBlock?.classList.toggle("hidden", !showClassification);
  // if (!showClassification && diabeticStageInput) diabeticStageInput.value = "";
  const showDiabetesDuration = state.studyFlow === "kfre" && diabeticInput.value === "Yes";
  const showHypertensionDuration = state.studyFlow === "kfre" && getCheckedValue(hypertensionInputs) === "Yes";
  diabetesDurationBlock?.classList.toggle("hidden", !showDiabetesDuration);
  hypertensionDurationBlock?.classList.toggle("hidden", !showHypertensionDuration);
  if (diabetesDurationInput) {
    diabetesDurationInput.required = false;
    diabetesDurationInput.disabled = !showDiabetesDuration;
    if (!showDiabetesDuration) diabetesDurationInput.value = "";
  }
  if (hypertensionDurationInput) {
    hypertensionDurationInput.required = false;
    hypertensionDurationInput.disabled = !showHypertensionDuration;
    if (!showHypertensionDuration) hypertensionDurationInput.value = "";
  }
  updateLinkedPatientSummary();
  updateQuestionnaireContinueState();
}

ckdStageInput.addEventListener("change", updateDialysisVisibility);
knownCkdInputs.forEach((input) => input.addEventListener("change", () => updateKfreQuestionnaireVisibility({ clearHidden: true })));
diabeticInput.addEventListener("change", updateDiabeticVisibility);
dialysisInput.addEventListener("change", () => updateKfreQuestionnaireVisibility({ clearHidden: false }));

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

const hospitalDashboardTabs = [...document.querySelectorAll("[data-hospital-dashboard-view]")];
hospitalDashboardTabs.forEach((button, index) => {
  button.addEventListener("click", () => {
    state.hospitalDashboardView = button.dataset.hospitalDashboardView === "kfre" ? "kfre" : "egfr";
    updateDashboards();
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const nextButton = hospitalDashboardTabs[(index + offset + hospitalDashboardTabs.length) % hospitalDashboardTabs.length];
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
        type: upload.file.type || "",
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

function collectKfreLabValues() {
  return {
    age: kfreLabAgeInput?.value.trim() || "",
    sex: kfreLabSexInput?.value || "",
    egfr: kfreEgfrInput?.value.trim() || "",
    acr: kfreAcrInput?.value.trim() || "",
    pcr: kfrePcrInput?.value.trim() || "",
    serumCalcium: kfreSerumCalciumInput?.value.trim() || "",
    serumPhosphate: kfreSerumPhosphateInput?.value.trim() || "",
    serumBicarbonate: kfreSerumBicarbonateInput?.value.trim() || "",
    serumAlbumin: kfreSerumAlbuminInput?.value.trim() || ""
  };
}

function collectKfreForm() {
  const documentAvailable = getKfreDocumentAvailability() !== "No" ? "Yes" : "No";
  // Followup status removed — hospitalization/dialysis/transplant now always collected
  // const hasFollowup = kfreFollowupStatusInput.value === "Available";
  // const hasKidneyFailureEvent = kfreKidneyFailureEventInput.value === "Yes";
  return {
    documentAvailable,
    clinicalExamination: {
      systolicBp: kfreSystolicBpInput.value.trim(),
      diastolicBp: kfreDiastolicBpInput.value.trim(),
      heartRate: kfreHeartRateInput.value.trim(),
      // waistHipRatio replaced by individual fields (uncomment to revert)
      // waistHipRatio: kfreWaistHipRatioInput.value.trim(),
      waistCm: kfreWaistInput?.value.trim() || "",
      hipCm: kfreHipInput?.value.trim() || "",
      waistHipRatio: kfreWhrDisplay?.value || ""
    },
    clinicalEvents: {
      hospitalization: kfreHospitalizationInput.value,
      dialysisInitiated: kfreDialysisInitiatedInput.value,
      transplant: kfreTransplantInput.value
    },
    // Extended follow-up removed (uncomment block to revert)
    // followUp: hasFollowup ? { visit: kfreFollowupVisitInput.value, months: kfreFollowupMonthsInput.value.trim(), repeatCreatinine: kfreRepeatCreatinineInput.value.trim(), updatedEgfr: kfreUpdatedEgfrInput.value.trim(), ckdProgression: kfreCkdProgressionInput.value } : null,
    outcomes: {
      // ckdStage removed from outcomes (already in questionnaire — uncomment to revert)
      // ckdStage: kfreOutcomeCkdStageInput.value,
      rapidProgression: kfreRapidProgressionInput.value,
      kidneyFailureEvent: kfreKidneyFailureEventInput.value
      // eventDate/eventType removed (uncomment to revert)
      // eventDate: hasKidneyFailureEvent ? kfreKidneyFailureDateInput.value : "-",
      // eventType: hasKidneyFailureEvent ? kfreKidneyFailureTypeInput.value : "-"
    },
    labs: collectKfreLabValues()
  };
}

function getKfreReviewRows(kfreForm) {
  if (!kfreForm) return [];
  const examination = kfreForm.clinicalExamination || {};
  const events = kfreForm.clinicalEvents || {};
  const outcomes = kfreForm.outcomes || {};
  const labs = kfreForm.labs || {};
  const rows = [
    ["Blood Pressure", `${examination.systolicBp}/${examination.diastolicBp} mmHg`],
    ["Heart Rate", `${examination.heartRate} bpm`],
    // Waist/Hip now shown instead of single WHR (uncomment old line to revert)
    // ["Waist-to-Hip Ratio", examination.waistHipRatio],
    ["Waist", `${examination.waistCm} cm`],
    ["Hip", `${examination.hipCm} cm`],
    ["Waist-to-Hip Ratio", examination.waistHipRatio],
    // Outcome CKD Stage removed from KFRE review (captured in questionnaire — uncomment to revert)
    // ["Outcome CKD Stage", formatCkdStage(outcomes.ckdStage)],
    ["Hospitalization", events.hospitalization],
    ["Dialysis Initiated", events.dialysisInitiated],
    ["Transplant", events.transplant],
    ["Rapid Progression", outcomes.rapidProgression],
    ["Kidney Failure Event", outcomes.kidneyFailureEvent]
    // Event date/type removed (uncomment to revert)
    // ["Failure Event Date", outcomes.eventDate], ["Failure Event Type", outcomes.eventType]
  ];
  const labRows = [
    ["eGFR", labs.egfr ? `${labs.egfr} mL/min/1.73 m²` : "-"],
    ["Urine ACR", labs.acr ? `${labs.acr} mg/g` : "-"],
    ["Urine PCR", labs.pcr ? `${labs.pcr} mg/g` : "-"],
    ["Serum Calcium", labs.serumCalcium ? `${labs.serumCalcium} mg/dL` : "-"],
    ["Serum Phosphate", labs.serumPhosphate ? `${labs.serumPhosphate} mg/dL` : "-"],
    ["Serum Bicarbonate", labs.serumBicarbonate ? `${labs.serumBicarbonate} mmol/L` : "-"],
    ["Serum Albumin", labs.serumAlbumin ? `${labs.serumAlbumin} g/dL` : "-"]
  ].filter(([, value]) => value !== "-");
  rows.push(...labRows);
  // Extended follow-up removed (uncomment block to revert)
  // if (kfreForm.followUp) { rows.push(...); }
  return rows;
}

function buildSubmissionFromForm() {
  const selectedHospital = getSelectableIntakeSources().find((hospital) => hospital.id === hospitalNameInput.value);
  const isKfre = state.studyFlow === "kfre";
  const kfreHasDocument = isKfre ? getKfreDocumentAvailability() !== "No" : false;
  const uploadMode = getUploadMode();
  const hospitalId = hospitalIdInput.value.trim();
  const hospitalName = selectedHospital?.name || "";
  const uhid = uhidInput.value.trim();
  const studyId = null;
  const enrollmentDate = enrollmentDateInput?.value || landingEnrollmentDateInput?.value || "";
  const siteCenter = siteCenterInput?.value.trim() || "-";  // siteCenterInput may be null (removed from KFRE intake)
  const consentObtained = isKfre ? (getCheckedValue(consentObtainedInputs) || "-") : "";  // consentObtainedInputs may be empty
  const intakeAge = ageInput.value.trim();
  const intakeSex = sexInput.value;
  const labAge = kfreLabAgeInput?.value.trim() || "";
  const labSex = kfreLabSexInput?.value || "";
  const age = intakeAge || labAge;
  const sex = (intakeSex === "Male" || intakeSex === "Female")
    ? intakeSex
    : (labSex || intakeSex);
  const heightCm = isKfre ? heightInput.value.trim() : "";
  const weight = isKfre ? weightInput.value.trim() : "";
  const bmi = isKfre ? bmiInput.value.trim() : "";
  const ethnicity = isKfre ? (ethnicityInput?.value.trim() || "-") : "";  // ethnicityInput may be null (removed)
  const occupation = isKfre ? (occupationInput?.value.trim() || "-") : "";  // occupationInput may be null (removed)
  const knownCkd = getCheckedValue(knownCkdInputs);
  const ckdDuration = isKfre ? ckdDurationInput.value.trim() : "";
  const ckdStage = isKfre
    ? (knownCkd === "No" ? "Normal" : ckdStageInput.value)
    : (knownCkd === "No" ? "Normal" : knownCkd === "Yes" ? "Other" : "");
  const ckdStageRemarks = isKfre
    ? (ckdStage === "Other" ? (ckdStageRemarksInput?.value.trim() || "-") : "-")  // ckdStageRemarksInput may be null
    : (knownCkd === "Yes" ? "CKD reported; stage not collected in simplified intake." : "-");
  const dialysis = isKfre ? getDialysisValue() : "";
  const dialysisFrequency = isKfre ? dialysisFrequencyInput.value.trim() : "";
  const diabetic = diabeticInput.value;
  // diabeticStageInput removed from KFRE intake (uncomment to revert)
  const diabeticStage = (diabeticInput.value === "Yes" ? "Not collected in simplified intake" : "-");
  // const diabeticStage = isKfre && diabeticInput.value === "Yes" ? (diabeticStageInput?.value || "-") : (diabeticInput.value === "Yes" ? "Not collected" : "-");
  const diabetesDuration = isKfre ? diabetesDurationInput.value.trim() : "";
  const hypertension = getCheckedValue(hypertensionInputs);
  const hypertensionDuration = isKfre ? hypertensionDurationInput.value.trim() : "";
  const cardiovascularDisease = isKfre ? getCheckedValue(cardiovascularDiseaseInputs) : "";
  const familyKidneyHistory = isKfre ? getCheckedValue(familyKidneyHistoryInputs) : "";
  const ultrasoundFindings = isKfre ? null : {
    right: collectKidneyFindings("right"),
    left: collectKidneyFindings("left"),
    ...collectUltrasoundQualityFindings()
  };
  const leftKidneyFile  = leftKidneyFileInput?.files[0];
  const rightKidneyFile = rightKidneyFileInput?.files[0];
  const egfrReportFile  = egfrReportInput?.files[0];
  const patientPackageFile = preparedPatientPackageFile;
  const ultrasoundVideoFile = ultrasoundVideoFileInput.files[0];
  const kfreClinicalDocumentFile = kfreClinicalDocumentInput.files[0];

  if (!hospitalName || !hospitalId || !uhid) {
    showToast("Hospital, Hospital ID, and UHID are required.");
    return null;
  }

  studyIdInput.value = "";

  if (!validateQuestionnaireForClinicalUpload()) {
    return null;
  }

  if (isKfre && !egfrForm.checkValidity()) {
    egfrForm.reportValidity();
    showToast("Complete all required KFRE clinical and outcome fields.");
    return null;
  }

  if (isKfre && !kfreHasDocument) {
    if (!age || !sex) {
      showToast("Enter age and sex for the KFRE lab entry.");
      return null;
    }
    if (!Number.isFinite(Number(age)) || Number(age) < 18 || Number(age) > 100) {
      showToast("Enter age between 18 and 100 years for the KFRE lab entry.");
      return null;
    }
    if (!['Male', 'Female'].includes(sex)) {
      showToast("Select sex (Male or Female) for the KFRE lab entry.");
      return null;
    }
    if (!kfreEgfrInput?.value.trim() || !validateNumericInput(kfreEgfrInput)) {
      showToast("Enter eGFR value for the KFRE lab entry.");
      return null;
    }
    if (kfreAcrInput?.value.trim() && !validateNumericInput(kfreAcrInput)) {
      showToast("Enter a valid Urine ACR value for the KFRE lab entry.");
      return null;
    }
    if (!kfrePcrInput?.value.trim() || !validateNumericInput(kfrePcrInput)) {
      showToast("Enter Urine PCR value for the KFRE lab entry.");
      return null;
    }
  }

  if (isKfre && Number(kfreSystolicBpInput.value) <= Number(kfreDiastolicBpInput.value)) {
    showToast("Systolic blood pressure must be greater than diastolic blood pressure.");
    kfreSystolicBpInput.focus();
    return null;
  }

  // Event date removed from KFRE intake (uncomment to revert)
  // if (isKfre && kfreKidneyFailureEventInput.value === "Yes" && !validateDateInput(kfreKidneyFailureDateInput)) {
  //   kfreKidneyFailureDateInput.reportValidity();
  //   return null;
  // }

  const invalidKidneyMeasurement = !isKfre && Array.from(kidneyMeasurementInputs)
    .find((input) => input.value.trim() && !validateNumericInput(input));
  if (invalidKidneyMeasurement) {
    invalidKidneyMeasurement.reportValidity();
    invalidKidneyMeasurement.focus();
    return null;
  }

  if (!age || !sex) {
    showToast("Age and sex are required.");
    return null;
  }

  if (Number(age) < 18) {
    showToast("Patient age must be 18 or above.");
    return null;
  }

  if (!knownCkd) {
    showToast("Select Chronic Kidney Disease (CKD) status.");
    return null;
  }

  if (!diabetic) {
    showToast("Select diabetic status.");
    return null;
  }

  if (!hypertension) {
    showToast("Select hypertension status.");
    return null;
  }

  let uploadFiles = [];

  if (isKfre) {
    if (kfreHasDocument) {
      if (!kfreClinicalDocumentFile) {
        showToast("Upload the KFRE clinical document.");
        return null;
      }
      uploadFiles = [{ fieldName: "clinicalDocument", file: kfreClinicalDocumentFile }];
    } else {
      uploadFiles = [];
    }
  } else {
    if (patientPackageIsPreparing) {
      showToast("Please wait until the patient package is prepared.");
      return null;
    }

    if (!patientPackageFile) {
      showToast("Upload a ZIP file or Select files, or choose a Folder to Submit.");
      return null;
    }

    uploadFiles = [
      { fieldName: "patientPackage", file: patientPackageFile }
    ];
  }

  if (!isKfre && ultrasoundVideoFile) {
    uploadFiles.push({ fieldName: "ultrasoundVideo", file: ultrasoundVideoFile });
  }

  const oversizedUpload = uploadFiles.find((upload) => isOversizedUpload(upload.file));
  if (oversizedUpload) {
    showToast(getOversizedUploadMessage(oversizedUpload.file, getUploadLabel(oversizedUpload.fieldName)));
    return null;
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
    weight: weight || "-",
    bmi: bmi || "-",
    ethnicity: ethnicity || "-",
    occupation: occupation || "-",
    knownCkd: knownCkd || "-",
    ckdDuration: ckdDuration || "-",
    ckdStage,
    ckdStageRemarks,
    dialysis: dialysis || "-",
    dialysisFrequency: dialysisFrequency || "-",
    diabetic,
    diabeticStage,
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
    status: "Ready for Cloud Upload",
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
    ["Upload Method", subUploadMode(submission.uploadMode)],
    ["Age", submission.age],
    ["Sex", submission.sex],
    ["Chronic Kidney Disease (CKD)", submission.knownCkd || "-"],
    ["Diabetes", submission.diabetic],
    ["Hypertension", submission.hypertension || "-"]
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
    reviewTitle.textContent = submission.studyFlow === "kfre" ? "Confirm KFRE Record" : "Confirm eGFR Record";
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
  updateKfreDocumentAvailability({ clearHidden: true });
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
  setLandingEnrollmentDateToday();
  hospitalNameInput.value = landingHospitalInput.value;
  hospitalIdInput.value = landingHospitalIdInput.value;
  updateGeneratedStudyId();
  if (consentCheckbox) consentCheckbox.checked = false;
  if (kfreConsentCheckbox) kfreConsentCheckbox.checked = false;
  if (consentContinueBtn) {
    consentContinueBtn.disabled = true;
    consentContinueBtn.textContent = "Accept & Continue";
  }
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
    showToast("No record is waiting for upload.");
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
    activateTab("landing");
    window.setTimeout(() => {
      scrollToLandingSection(intakeWorkspace);
      landingUhidInput?.focus({ preventScroll: true });
    }, 100);
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
    showToast("Upload interrupted: " + err.message + " You can resume from the confirmation window.");
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
    populateHospitals();
    activateTab("landing");
    updateLandingHospitalId();
    initializeGlobalValidation();
    initializeFilePreviews();
    updateUploadModeVisibility();
    updateDialysisVisibility();
    updateDiabeticVisibility();
    applyHospitalAuthContext();
    setLandingEnrollmentDateToday();
    loadHospitalSession();
    updateGeneratedStudyId();
    updateConsentContext();
    updateLinkedPatientSummary();
    refreshDashboard();
    if (pendingAnonymizationOpen) {
      pendingAnonymizationOpen = false;
      showAnonymizationWorkspace();
    }
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
  anonymizationScreen?.classList.add("hidden");
  showLoginScreen();
  document.getElementById("login-username") && (document.getElementById("login-username").value = "");
  document.getElementById("login-password") && (document.getElementById("login-password").value = "");
});

studyFlowSwitch?.addEventListener("change", (event) => {
  switchStudyFlow(event.target.value);
});

anonymizationFolderInput?.addEventListener("change", () => {
  if (anonymizationFileInput) anonymizationFileInput.value = "";
  updateAnonymizationDemo(anonymizationFolderInput.files, "Folder");
});

anonymizationFileInput?.addEventListener("change", () => {
  if (anonymizationFolderInput) anonymizationFolderInput.value = "";
  updateAnonymizationDemo(anonymizationFileInput.files, "Selection");
});

anonymizationResetBtn?.addEventListener("click", () => {
  clearAnonymizationDemo("Demo selection cleared.");
});

anonymizationApproveBtn?.addEventListener("click", () => {
  clearAnonymizationDemo("Irreversible anonymized output approved. Temporary originals removed in this demo flow.");
  showToast("Irreversible anonymization demo approved and temporary originals cleared.");
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
  loadPublicDashboard();
  setLandingEnrollmentDateToday();
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
        showPublicScreen();
        return;
      }
    } catch {
      // Network error — optimistically show app with cached session
      await loadHospitalsFromApi();
      showApp();
      applyHospitalAuthContext();
    }
  } else {
    showPublicScreen();
    return; // Don't init the rest of the app yet — will happen after login
  }

  // These run only when the session is ready
  applyStudyFlowUI();
  populateHospitals();
  setLandingEnrollmentDateToday();
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
