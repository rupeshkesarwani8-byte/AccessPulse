const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

function formatDetail(detail, fallback) {
  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (item && item.msg) {
        const field = Array.isArray(item.loc) ? item.loc.slice(1).join(".") : "";
        return field ? `${field}: ${item.msg}` : item.msg;
      }
      return String(item);
    });
    return parts.join("; ");
  }

  return fallback;
}

function buildError(data, response, fallbackPrefix) {
  const error = new Error(
    formatDetail(data?.detail, `${fallbackPrefix} (${response.status})`)
  );
  error.status = response.status;
  return error;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw buildError(data, response, "Request failed");
  }

  return data;
}

export const api = {
  health: () => request("/api/health"),

  getReports: (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.status && filters.status !== "all") params.set("status", filters.status);
    if (filters.type && filters.type !== "all") params.set("barrier_type", filters.type);
    if (filters.search?.trim()) params.set("search", filters.search.trim());

    const query = params.toString();
    return request(`/api/reports${query ? `?${query}` : ""}`);
  },

  getStats: () => request("/api/stats"),

  // Active reports ranked by repair priority. Needs an admin token.
  getPriority: (token, limit = 8) =>
    request(`/api/priority?limit=${limit}`, { token }),

  // Status changes for one report, newest first. Needs an admin token.
  getHistory: (id, token) =>
    request(`/api/reports/${id}/history`, { token }),

  createReport: (report) =>
    request("/api/reports", {
      method: "POST",
      body: JSON.stringify(report),
    }),

  // Sends the photo as multipart form data. The browser sets the
  // Content-Type header itself, so none is set here.
  uploadPhoto: async (reportId, file) => {
    const body = new FormData();
    body.append("file", file);

    const response = await fetch(`${API_BASE}/api/reports/${reportId}/photo`, {
      method: "POST",
      body,
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw buildError(data, response, "Photo upload failed");
    }

    return data;
  },

  // Turns the relative photo_url from the API into a full address.
  photoSrc: (photoUrl) => (photoUrl ? `${API_BASE}${photoUrl}` : null),

  login: (username, password) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  updateStatus: (id, status, token) =>
    request(`/api/reports/${id}/status`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ status }),
    }),

  exportReports: async (token) => {
    const response = await fetch(`${API_BASE}/api/reports/export.csv`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw buildError(data, response, "Export failed");
    }

    return response.blob();
  },
};
