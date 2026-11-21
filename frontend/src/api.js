const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/u, '');

let activeToken = null;
let unauthorizedHandler = null;

export function setAuthToken(token) {
  activeToken = token ?? null;
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null;
}

export class NetworkError extends Error {
  constructor(cause) {
    super('Tidak dapat terhubung ke server');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.code ?? `HTTP_${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload?.error?.code ?? 'UNKNOWN';
    this.fields = payload?.error?.fields ?? null;
  }
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function request(
  path,
  { method = 'GET', body, token, idempotencyKey, skipAuthRedirect = false } = {},
) {
  const bearer = token !== undefined ? token : activeToken;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response;
  try {
    response = await fetch(apiBaseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new NetworkError(error);
  }

  if (response.status === 204) {
    return { status: 204, data: null };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Respons tanpa JSON tetap diperlakukan sebagai kegagalan HTTP di bawah.
  }

  if (!response.ok) {
    if (response.status === 401 && !skipAuthRedirect && bearer && unauthorizedHandler) {
      unauthorizedHandler('Sesi Anda berakhir. Silakan masuk kembali.');
    }
    throw new ApiError(response.status, payload);
  }

  return payload;
}

// ---------- Auth ----------

export async function login(email, password) {
  const payload = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    token: null,
    skipAuthRedirect: true,
  });
  return payload.data;
}

// ---------- Users (Admin) ----------

export async function getUsers(params = {}) {
  const payload = await request(`/api/v1/users${buildQuery(params)}`);
  return payload.data;
}

export async function createUser(body) {
  const payload = await request('/api/v1/users', {
    method: 'POST',
    body,
  });
  return payload.data;
}

export async function updateUser(id, body) {
  const payload = await request(`/api/v1/users/${id}`, {
    method: 'PATCH',
    body,
  });
  return payload.data;
}

// ---------- Items & Batches ----------

export async function getItems(params = {}) {
  return request(`/api/v1/items${buildQuery(params)}`);
}

export async function getItemById(id) {
  const payload = await request(`/api/v1/items/${id}`);
  return payload.data;
}

export async function createItem(body) {
  const payload = await request('/api/v1/items', {
    method: 'POST',
    body,
  });
  return payload.data;
}

export async function updateItem(id, body) {
  const payload = await request(`/api/v1/items/${id}`, {
    method: 'PATCH',
    body,
  });
  return payload.data;
}

export async function deleteItem(id) {
  const result = await request(`/api/v1/items/${id}`, {
    method: 'DELETE',
  });
  if (result.status === 204) {
    return { status: 204, action: 'DELETED', data: null };
  }
  return { status: 200, action: result.data?.action ?? 'ARCHIVED', data: result.data };
}

export async function getItemBatches(id, params = {}) {
  const payload = await request(`/api/v1/items/${id}/batches${buildQuery(params)}`);
  return payload.data;
}

// ---------- Dashboard & Transactions ----------

export async function getDashboard(params = {}) {
  const payload = await request(`/api/v1/dashboard${buildQuery(params)}`);
  return payload.data;
}

export async function getTransactions(params = {}) {
  return request(`/api/v1/transactions${buildQuery(params)}`);
}

// ---------- Stock Operations ----------

export async function saveReceipt({ token, receipt, idempotencyKey }) {
  const payload = await request('/api/v1/stock/receipts', {
    method: 'POST',
    body: receipt,
    token,
    idempotencyKey,
  });
  return payload.data;
}

export async function recordUsage({ token, usage, idempotencyKey }) {
  const payload = await request('/api/v1/stock/usages', {
    method: 'POST',
    body: usage,
    token,
    idempotencyKey,
  });
  return payload.data;
}

export async function recordDisposal({ token, disposal, idempotencyKey }) {
  const payload = await request('/api/v1/stock/disposals', {
    method: 'POST',
    body: disposal,
    token,
    idempotencyKey,
  });
  return payload.data;
}

// ---------- Reports (Admin) ----------

export async function getDisposalReport(params = {}) {
  const payload = await request(`/api/v1/reports/disposals${buildQuery(params)}`);
  return payload.data;
}
