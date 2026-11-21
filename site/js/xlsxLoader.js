import { el } from './ui.js';

// SheetJS (about 1 MB) is fetched once, only when a screen needs it — never on the sign-in or student screens.
// A failed load (network error, or a script that did not define XLSX) is forgotten, so the next need tries again.

const XLSX_SRC = 'vendor/xlsx.full.min.js';

let xlsxLoading = null;

export function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxLoading) {
    xlsxLoading = new Promise((resolve, reject) => {
      const script = el('script', { src: XLSX_SRC });
      const fail = () => {
        script.remove();
        xlsxLoading = null;
        reject(new Error('xlsx'));
      };
      script.addEventListener('load', () => (window.XLSX ? resolve(window.XLSX) : fail()));
      script.addEventListener('error', fail);
      document.head.append(script);
    });
  }
  return xlsxLoading;
}
