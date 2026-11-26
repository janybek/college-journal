// Line icons drawn for this site on a 24×24 grid (stroke, no fill), built as SVG nodes — never from an HTML string.
// Each icon is a list of shapes: a string is a path, an object is a circle or a rectangle.
const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  home: ['M3.5 10.5 12 3.5l8.5 7', 'M5.5 9v10.5A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V9', 'M10 21v-5.5h4V21'],
  layers: ['M12 3.5 2.5 8.5l9.5 5 9.5-5z', 'M2.5 12.5l9.5 5 9.5-5', 'M2.5 16.5l9.5 5 9.5-5'],
  cap: ['M12 4.5 2 9.5l10 5 10-5z', 'M6 11.5v4.7c0 1.6 2.7 3.3 6 3.3s6-1.7 6-3.3v-4.7', 'M22 9.5v5'],
  briefcase: [
    { rect: [3, 7, 18, 13.5, 2] },
    'M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7', 'M3 12.5h18', 'M12 11.5v2',
  ],
  // A list of names: «Дисциплины».
  list: ['M9 6.5h11', 'M9 12h11', 'M9 17.5h11', 'M4.5 6.5h.01', 'M4.5 12h.01', 'M4.5 17.5h.01'],
  book: ['M12 6.5C10.3 5.2 7.6 4.5 3 4.5v14c4.6 0 7.3.7 9 2 1.7-1.3 4.4-2 9-2v-14c-4.6 0-7.3.7-9 2z', 'M12 6.5v14'],
  door: ['M5.5 21V4.5A1.5 1.5 0 0 1 7 3h10a1.5 1.5 0 0 1 1.5 1.5V21', 'M3 21h18', 'M14.5 12h.01'],
  sheetUp: [
    'M13.5 3h-7A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-11z', 'M13.5 3v5.5H19',
    'M12 18v-6.5', 'M9.5 14 12 11.5l2.5 2.5',
  ],
  sheet: [
    'M13.5 3h-7A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-11z', 'M13.5 3v5.5H19',
    'M8.5 12.5h7M8.5 16.5h7M12 12.5v4',
  ],
  sun: [{ circle: [12, 12, 4] }, 'M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4'],
  moon: ['M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a7 7 0 0 0 10.8 10.8z'],
  menu: ['M4 6.5h16M4 12h16M4 17.5h16'],
  close: ['M6 6l12 12M18 6 6 18'],
  search: [{ circle: [11, 11, 6.5] }, 'M20 20l-4.4-4.4'],
  logout: ['M9.5 20.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5h3.5', 'M15.5 16.5 20 12l-4.5-4.5', 'M20 12H9.5'],
  pencil: ['M4 20h4.2L19.3 8.9a2.1 2.1 0 0 0 0-3l-1.2-1.2a2.1 2.1 0 0 0-3 0L4 15.8z', 'M13.5 6.5l4 4'],
  key: [{ circle: [8, 15.5, 4] }, 'M10.9 12.6 20 3.5', 'M16.5 7l2.5 2.5', 'M18.5 5l2 2'],
  trash: [
    'M4 6.5h16', 'M9 6.5V5A1.5 1.5 0 0 1 10.5 3.5h3A1.5 1.5 0 0 1 15 5v1.5',
    'M6.5 6.5l.9 12.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.6', 'M10 10.5v6M14 10.5v6',
  ],
  plus: ['M12 5v14M5 12h14'],
  download: ['M12 3.5v12', 'M7.5 11l4.5 4.5 4.5-4.5', 'M4.5 20.5h15'],
  upload: ['M12 15.5v-12', 'M7.5 8 12 3.5 16.5 8', 'M4.5 20.5h15'],
  printer: [
    'M7 8.5v-5h10v5', 'M7 17.5H5A1.5 1.5 0 0 1 3.5 16v-6A1.5 1.5 0 0 1 5 8.5h14a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-2',
    'M7 14h10v6.5H7z',
  ],
  copy: [{ rect: [8.5, 8.5, 12, 12, 2] }, 'M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3'],
  calendar: [{ rect: [3.5, 5, 17, 15.5, 2] }, 'M3.5 10h17', 'M8 3v4M16 3v4'],
  chart: ['M5 20.5V12', 'M12 20.5V4.5', 'M19 20.5v-11'],
  clipboard: [
    'M15.5 4.5H17A1.5 1.5 0 0 1 18.5 6v13.5A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 7 4.5h1.5',
    { rect: [8.5, 3, 7, 3.5, 1] }, 'M9 11.5h6M9 15.5h4',
  ],
  bell: ['M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z', 'M10 21h4'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  checkCircle: [{ circle: [12, 12, 9] }, 'M8 12.5l2.7 2.7L16 10'],
  alert: [{ circle: [12, 12, 9] }, 'M12 7.5v5.5', 'M12 16.5h.01'],
  info: [{ circle: [12, 12, 9] }, 'M12 11v5.5', 'M12 7.5h.01'],
  chevron: ['M9.5 6l6 6-6 6'],
  arrowUp: ['M12 19V5', 'M5.5 11.5 12 5l6.5 6.5'],
  settings: ['M20.5 7H10', 'M14 17H3.5', { circle: [7, 7, 3] }, { circle: [17, 17, 3] }],
  grid: [{ rect: [3.5, 4, 17, 16.5, 2] }, 'M3.5 9.5h17', 'M9 9.5v11M14.5 9.5v11', 'M3.5 15h17'],
  // A register of rows and columns: «Журнал».
  table: [{ rect: [3.5, 4.5, 17, 15, 2] }, 'M3.5 9.5h17', 'M3.5 14.5h17', 'M9 9.5v10'],
  clock: [{ circle: [12, 12, 9] }, 'M12 7.5V12l3 2'],
  calendarOff: [{ rect: [3.5, 5, 17, 15.5, 2] }, 'M3.5 10h17', 'M8 3v4M16 3v4', 'M9.5 13.5l5 5M14.5 13.5l-5 5'],
  // The brand: a register with a tick.
  journal: ['M5 5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2z', 'M5 20a2 2 0 0 0 2 2h12', 'M9 10.5l2 2 4-4'],
};

function shape(def) {
  if (typeof def === 'string') return node('path', { d: def });
  if (def.circle) {
    const [cx, cy, r] = def.circle;
    return node('circle', { cx, cy, r });
  }
  const [x, y, width, height, rx] = def.rect;
  return node('rect', { x, y, width, height, rx });
}

function node(tag, attrs) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  return element;
}

// An icon is decoration: the button or link it sits in carries the words.
export function icon(name, className = '') {
  const svg = node('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
    class: ('icon ' + className).trim(),
  });
  for (const def of ICONS[name]) svg.append(shape(def));
  return svg;
}
