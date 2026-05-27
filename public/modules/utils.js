export function showToast(message, duration = 2400) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), duration);
}

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

export function formatCkdStage(value, remarks = "") {
  if (!value) return "--";
  if (value === "Normal") return "Normal";
  if (value === "Other") return remarks ? `Other — ${remarks}` : "Other";
  return `Stage ${value}`;
}

export function getCkdStageClass(value) {
  return String(value || "other").toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export function cleanIdentifier(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80);
}

export function cleanDecimalValue(value, { integer = false } = {}) {
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

export function validateDateInput(input) {
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

export function formatDisplayDate(value) {
  if (!value) {
    return "--";
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function formatBytes(bytes) {
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

export function getUploadLabel(fieldName) {
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
