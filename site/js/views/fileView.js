import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, modal, showModal, note } from '../ui.js';
import { icon } from '../icons.js';
import { mimeOf, viewWay, downloadName, base64ToBytes } from '../work.js';

// The window of a file of a work. The file comes through work.file only (after the server checked the right), as base64;
// the site builds a Blob whose type is chosen by the kind written in the list row (never by the name and never by the answer),
// shows a picture on the page, opens a PDF in a new tab and offers anything else for saving. The address of the Blob is
// dropped when the window closes. The name of the file is only ever text.

// openFile({ fileId, name, kind }) resolves when the window is closed.
export function openFile({ fileId, name, kind, host = document.body }) {
  return new Promise((resolve) => {
    let url = null;
    let closed = false;
    const body = el('div', { class: 'file-view' });
    const onHash = () => dialog.close();
    const dialog = modal({
      id: 'file-view', labelledBy: 'file-view-title', className: 'dialog--file',
      onClose: () => {
        closed = true;
        window.removeEventListener('hashchange', onHash);
        if (url !== null) URL.revokeObjectURL(url);
        url = null;
        dialog.remove();
        resolve();
      },
    },
    el('h2', { class: 'dialog__title file-view__title', id: 'file-view-title' }, name),
    body,
    el('div', { class: 'dialog__actions' }, el('button', { type: 'button', id: 'file-view-close', class: 'button button--secondary', onclick: () => dialog.close() }, t('common.close'))));
    window.addEventListener('hashchange', onHash);
    body.append(el('p', { class: 'loading', id: 'file-view-loading' }, t('work.file.loading')));
    showModal(host, dialog);
    load();

    function fail(key) {
      body.replaceChildren(note('error', t(key), { id: 'file-view-error', role: 'alert' }));
    }

    async function load() {
      let file;
      try {
        file = (await call('work.file', { fileId })).file;
      } catch (error) {
        if (!closed) fail(errorKey(error.code));
        return;
      }
      if (closed) return;
      let blob;
      try {
        if (!file || file.kind !== kind || typeof file.data !== 'string') throw new Error('kind');
        blob = new Blob([base64ToBytes(file.data)], { type: mimeOf(kind) });
      } catch (error) {
        fail('work.file.broken');
        return;
      }
      url = URL.createObjectURL(blob);
      const way = viewWay(kind);
      const save = el('a', { class: 'button button--secondary', id: 'file-view-save', href: url, download: downloadName(name, kind) }, icon('download'), t('work.file.download'));
      const parts = [];
      if (way === 'image') parts.push(el('img', { class: 'file-view__image', id: 'file-view-image', src: url, alt: name }));
      if (way === 'open') parts.push(el('a', { class: 'button button--primary', id: 'file-view-open', href: url, target: '_blank', rel: 'noopener' }, t('work.file.open')));
      parts.push(save);
      body.replaceChildren(el('div', { class: 'file-view__shown' }, parts));
    }
  });
}
