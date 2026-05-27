import { state } from "./state.js";

export const hospitals = [];

let unauthorizedHandler = null;

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

export function authedFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.authSession?.token) {
    headers["Authorization"] = `Bearer ${state.authSession.token}`;
  }
  return fetch(url, { ...options, headers });
}

export async function loadHospitalsFromApi(populateHospitals) {
  try {
    const res = await authedFetch("/api/hospitals");
    const result = await res.json();
    if (result.ok && Array.isArray(result.hospitals)) {
      hospitals.length = 0;
      result.hospitals.forEach((hospital) => hospitals.push(hospital));
      populateHospitals?.();
    }
  } catch { /* non-fatal; hospitals already populated from previous call */ }
}

export function handle401() {
  unauthorizedHandler?.();
}
