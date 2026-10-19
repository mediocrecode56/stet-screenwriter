// Title page layout on the character grid (rows from the top edge of the page).
// Shared by the on-screen title page editor and the print model.

export const TITLE_FIELDS_SPEC = [
  { key: 'title', row: 20, col: 15, w: 60, align: 'c', ph: 'TITLE' },
  { key: 'credit', row: 23, col: 15, w: 60, align: 'c', ph: 'Written by' },
  { key: 'author', row: 25, col: 15, w: 60, align: 'c', ph: 'Author Name' },
  { key: 'source', row: 28, col: 15, w: 60, align: 'c', ph: 'Based on… (optional)' },
  { key: 'contact', row: 54, col: 15, w: 32, rows: 5, ph: 'Contact information\nAddress\nPhone\nEmail' },
  { key: 'revision', row: 56, col: 48, w: 27, align: 'r', ph: 'Revision (optional)' },
  { key: 'draftDate', row: 57, col: 48, w: 27, align: 'r', ph: 'Draft date (optional)' },
];
