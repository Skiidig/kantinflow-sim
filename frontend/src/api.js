const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/u, '');

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

async function request(path, { method = 'GET', body, token, idempotencyKey } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
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

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Respons tanpa JSON tetap diperlakukan sebagai kegagalan HTTP di bawah.
  }
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}

export async function login(email, password) {
  const payload = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  return payload.data;
}

export async function saveReceipt({ token, receipt, idempotencyKey }) {
  const payload = await request('/api/v1/stock/receipts', {
    method: 'POST',
    body: receipt,
    token,
    idempotencyKey,
  });
  return payload.data;
}
