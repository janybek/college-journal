// Address of the journal server on the owner's computer (Tailscale Funnel): 'https://<name>.ts.net/api'.
// The copy of the site on GitHub Pages talks to it. While it is empty that copy says «not connected».
export const PRODUCTION_API_URL = 'https://journal.tail750a0e.ts.net/api';

export const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

// The only host whose copy of the site talks to the owner's computer (browsers give the host name in lower case).
export const GITHUB_PAGES_HOST = 'janybek.github.io';

// The stand answers on its own /api. A copy served by the journal server itself (the container on the college
// cluster) uses its own /api too: the site and the API are at one address. Only the GitHub Pages copy talks to
// the owner's computer, if the address looks right (https, a host, the path /api, no spaces, query or fragment);
// otherwise: '' — «not connected».
export function apiUrlFor(hostname, productionUrl = PRODUCTION_API_URL) {
  if (LOCAL_HOSTS.includes(hostname)) return '/api';
  if (hostname === GITHUB_PAGES_HOST)
    return /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?\/api$/.test(productionUrl) ? productionUrl : '';
  return '/api';
}

// The address comes from here only: not from the address bar of the page and not from the browser storage.
export const API_URL = apiUrlFor(location.hostname);
