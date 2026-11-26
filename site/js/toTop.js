import { t } from './i18n.js';
import { el } from './ui.js';
import { icon } from './icons.js';

// The round «Наверх» button at the bottom right. A screen opts in by marking the place to return to with the
// attribute data-to-top (the value «saved» when the screen has a bar of buttons at the bottom) (the row of sections, the tabs of a form): the button appears once the page is scrolled
// below the first screen and takes the person back to that place. No marked place on the page, no button.
let button = null;

function target() {
  return document.querySelector('[data-to-top]');
}

function update() {
  if (!button) return;
  const show = target() !== null && window.scrollY > window.innerHeight;
  button.hidden = !show;
  // A form keeps a bar of «Сохранить» at the bottom: the button stands above it.
  button.classList.toggle('to-top--lifted', show && target().dataset.toTop === 'saved');
  if (show) button.setAttribute('aria-label', t('common.toTop')), button.title = t('common.toTop');
}

export function initToTop() {
  if (button) return;
  button = el('button', {
    type: 'button', class: 'to-top', id: 'to-top', hidden: true,
    onclick: () => {
      const place = target();
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (place) place.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
    },
  }, icon('arrowUp'));
  document.body.append(button);
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('hashchange', update);
  new MutationObserver(update).observe(document.getElementById('page') || document.body, { childList: true, subtree: true });
  update();
}
