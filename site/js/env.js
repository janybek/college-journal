// The test journal is the site served from GitHub Pages; the stand (localhost) and the live journal show no mark.
// The host name is the same as GITHUB_PAGES_HOST in config.js (not imported: that file reads `location` on load).
export function isTestSite(hostname) {
  return hostname === 'janybek.github.io';
}
