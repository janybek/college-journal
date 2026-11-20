import { t } from '../i18n.js';
import { el } from '../ui.js';

// Stand-in for the directory and import screens, which arrive in the next step.
export function render(root, params) {
  const title = params.table ? t('dir.' + params.table) : t('import.title');
  root.append(el('section', { class: 'sheet sheet--label', 'aria-labelledby': 'placeholder-title' },
    el('p', { class: 'eyebrow' }, t('home.directories')),
    el('h1', { class: 'sheet__title', id: 'placeholder-title' }, title),
    el('p', { class: 'sheet__lead' }, t('placeholder.text')),
    el('a', { class: 'button button--quiet', href: '#/' }, t('common.toHome'))));
}
