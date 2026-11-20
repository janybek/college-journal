// Address of the published Apps Script web app. Redeploy with clasp deploy -i <deploymentId> so it never changes.
export const PRODUCTION_API_URL = 'https://script.google.com/macros/s/AKfycbzEWQGNhEydDovMVgCTmwTjM9mwwmB_cHhrfYu7xAt34bznstEbXy3zoaqBnYtnOjkg3A/exec';

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

// The local stand answers on /api; everywhere else the site talks to Apps Script.
export const API_URL = LOCAL_HOSTS.includes(location.hostname) ? '/api' : PRODUCTION_API_URL;
