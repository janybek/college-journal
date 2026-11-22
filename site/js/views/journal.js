import { t } from '../i18n.js';
import { el, pageHeader } from '../ui.js';

// The journal of a subject (#/journal/<subjectId>). For now only its heading: the grid of students and pairs comes
// with the next task, so the links of the list do not lead back home.
export function render(root) {
  root.append(
    pageHeader({ id: 'journal-title', title: t('journal.title') }),
    el('p', { class: 'loading' }, t('journal.loading')));
}
