// The Excel file of a syllabus is for the first fill only; after that the syllabus is changed on the site.
// hasApproved: the syllabus (discipline + teacher + half of the year) has an approved version.
// topicRows: how many rows of «Темы» the open draft holds (0 when there is no draft).
export function canFillFromFile({ hasApproved, topicRows }) {
  return hasApproved === false && topicRows === 0;
}
