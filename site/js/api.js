import { API_URL } from '../config.js';
import { getToken, clearSession } from './session.js';

// One endpoint for everything: POST {action, token, data} as text/plain (no CORS preflight on Apps Script).
export class ApiError extends Error {
  constructor(code, fields) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.fields = fields;
  }
}

let sessionEnded = () => {};

// Registers what to do after the server rejected the session (the session is already cleared then).
export function onSessionEnd(fn) {
  sessionEnded = fn;
}

// Returns `data` of a successful answer; throws ApiError otherwise.
export async function call(action, data = {}) {
  if (API_URL === '') throw new ApiError('not_configured');
  let body;
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: getToken(), data }),
    });
    body = await response.json();
  } catch (error) {
    throw new ApiError('network');
  }
  if (body === null || typeof body !== 'object' || typeof body.ok !== 'boolean') throw new ApiError('network');
  if (body.ok) return body.data;
  const error = body.error !== null && typeof body.error === 'object' ? body.error : {};
  const code = typeof error.code === 'string' ? error.code : 'internal';
  if (code === 'unauthorized') {
    clearSession();
    sessionEnded();
  }
  throw new ApiError(code, Array.isArray(error.fields) ? error.fields : undefined);
}
