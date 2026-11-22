// Address of the journal server on the owner's computer (Tailscale Funnel): 'https://<name>.ts.net/api'.
// While it is empty the site says «not connected». It is written at the deployment (task 13).
export const PRODUCTION_API_URL = '';

export const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

// The stand answers on its own /api; any other page talks to the journal server, if its address looks right
// (https, a host, the path /api, no spaces, query or fragment). Otherwise: '' — «not connected».
export function apiUrlFor(hostname, productionUrl = PRODUCTION_API_URL) {
  if (LOCAL_HOSTS.includes(hostname)) return '/api';
  return /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?\/api$/.test(productionUrl) ? productionUrl : '';
}

// The address comes from here only: not from the address bar of the page and not from the browser storage.
export const API_URL = apiUrlFor(location.hostname);
