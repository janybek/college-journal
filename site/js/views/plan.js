import { renderSubject } from './topics.js';

// The syllabus of one subject (#/plan/<subjectId>): the «Темы» screen without the choice of subject. A teacher
// opens it from «Мои предметы» and edits the topics of their own subjects; the server answers `forbidden` for a
// subject of another teacher and `not_found` for an unknown one.

export { leave } from './topics.js';

export function render(root, { subjectId }) {
  renderSubject(root, subjectId);
}
