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

// Failures worth trying again; any other answer would not change on a retry.
export const RETRYABLE = ['network', 'server_down', 'internal'];

// No usable answer: a phone without internet is «network»; a device that is online but got nothing (the computer of the
// journal is off, the tunnel answers with an error page) is «server_down».
export function failureCode(online) {
  return online === false ? 'network' : 'server_down';
}

const failure = () => new ApiError(failureCode(globalThis.navigator ? globalThis.navigator.onLine : undefined));

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
    throw failure();
  }
  return settle(body);
}

// The answer of the server as a value: `data` of a successful one, ApiError of any other.
function settle(body) {
  if (body === null || typeof body !== 'object' || typeof body.ok !== 'boolean') throw failure();
  if (body.ok) return body.data;
  const error = body.error !== null && typeof body.error === 'object' ? body.error : {};
  const code = typeof error.code === 'string' ? error.code : 'internal';
  if (code === 'unauthorized') {
    clearSession();
    sessionEnded();
  }
  throw new ApiError(code, Array.isArray(error.fields) ? error.fields : undefined);
}

const UPLOAD_TIMEOUT_MS = 180000;

// The same request as `call`, sent by XMLHttpRequest so that the progress of the upload is known (a file of 10 MB on a
// phone takes a while). Because of `xhr.upload.onprogress` the browser first sends OPTIONS (CORS preflight); the working
// server answers it, and the stand does not need it (the site and /api share an address). onProgress(share 0…1).
export function upload(action, data, { onProgress = () => {}, makeXhr = () => new XMLHttpRequest() } = {}) {
  return new Promise((resolve, reject) => {
    if (API_URL === '') {
      reject(new ApiError('not_configured'));
      return;
    }
    const xhr = makeXhr();
    const fail = () => reject(failure());
    xhr.open('POST', API_URL);
    xhr.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event && event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
      };
    }
    xhr.onerror = fail;
    xhr.ontimeout = fail;
    xhr.onabort = fail;
    xhr.onload = () => {
      if (xhr.status === 413) {
        reject(new ApiError('too_big'));
        return;
      }
      let body;
      try {
        body = JSON.parse(xhr.responseText);
      } catch (error) {
        fail();
        return;
      }
      try {
        resolve(settle(body));
      } catch (error) {
        reject(error);
      }
    };
    xhr.send(JSON.stringify({ action, token: getToken(), data }));
  });
}
