// Address of the published Apps Script web app. Empty until the deployment task (Task 12) fills it in.
export const PRODUCTION_API_URL = '';

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

// The local stand answers on /api; everywhere else the site talks to Apps Script.
export const API_URL = LOCAL_HOSTS.includes(location.hostname) ? '/api' : PRODUCTION_API_URL;
