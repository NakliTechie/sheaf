// tour.js — the first-run walkthrough. A spotlight cutout over a real toolbar/empty-state
// element plus a positioned card, six steps. Ported from Slate's tour (the Bench sibling);
// same mechanics — keyboard-driven, focus-trapped, one-time via localStorage, replayable
// from Help — with Sheaf's own steps. Every step anchors to an element that is present on
// the empty first-run screen (welcome actions + the always-rendered toolbar groups), so
// targetIsVisible never strands one: the rail and the More menu are hidden until a document
// is open, so no step points at them.

export const TOUR_KEY = 'sheaf.v1.tour-complete';

const STEPS = [
  {
    target: '#welcome .actions',
    title: 'Open a PDF to start',
    body: 'Drop a PDF anywhere, open one from disk, browse a folder, or start blank. It opens straight off your disk, is edited in this tab, and saves back — nothing is uploaded.',
  },
  {
    target: '#toolbar',
    title: 'Everything is one click away',
    body: 'File, page, annotation, and export commands all live up here. Hover any control to see its keyboard shortcut.',
  },
  {
    target: '#pageops',
    title: 'Work on the real document',
    body: 'Reorder, rotate, delete, insert, merge, and split pages — with OCR, forms, and export under More. These change the PDF’s structure, not a picture of it.',
  },
  {
    target: '#tb-tools',
    title: 'Mark it up — and redact for real',
    body: 'Highlight, draw, add text, and sign directly on the page. Redaction truly removes the content underneath — it is not a black box drawn over it.',
  },
  {
    target: '#tb-ai',
    title: 'AI is optional, and yours',
    body: 'The AI helper runs on your own key or a local model, and Sheaf works fully without it. Nothing leaves your browser unless you choose to send it.',
  },
  {
    target: '#tb-help',
    title: 'Save your way · help anytime',
    body: 'Ctrl+S saves to your file or a private download. Press ? for the full guide and shortcuts — and replay this tour from there whenever you like.',
  },
];

let layer = null;
let stepIndex = 0;
let previousFocus = null;
let activeSteps = STEPS;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function currentTarget() {
  return document.querySelector(activeSteps[stepIndex].target)
    || document.getElementById('toolbar')
    || document.body;
}

function targetIsVisible(step) {
  const target = document.querySelector(step.target);
  if (!target) return false;
  const rect = target.getBoundingClientRect();
  const style = getComputedStyle(target);
  return rect.width > 0 && rect.height > 0 &&
    style.display !== 'none' && style.visibility !== 'hidden';
}

function positionTour() {
  if (!layer) return;
  const target = currentTarget();
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const rect = target.getBoundingClientRect();
  const pad = 6;
  const spot = layer.querySelector('.tour-spotlight');
  spot.style.top = Math.max(4, rect.top - pad) + 'px';
  spot.style.left = Math.max(4, rect.left - pad) + 'px';
  spot.style.width = Math.max(24, Math.min(innerWidth - 8, rect.width + pad * 2)) + 'px';
  spot.style.height = Math.max(24, Math.min(innerHeight - 8, rect.height + pad * 2)) + 'px';

  const card = layer.querySelector('.tour-card');
  const cardRect = card.getBoundingClientRect();
  const gap = 18;
  const margin = 12;
  let top;
  let left;
  if (rect.bottom + gap + cardRect.height <= innerHeight - margin) {
    top = rect.bottom + gap;
    left = rect.left + rect.width / 2 - cardRect.width / 2;
  } else if (rect.top - gap - cardRect.height >= margin) {
    top = rect.top - gap - cardRect.height;
    left = rect.left + rect.width / 2 - cardRect.width / 2;
  } else if (rect.left - gap - cardRect.width >= margin) {
    top = rect.top + rect.height / 2 - cardRect.height / 2;
    left = rect.left - gap - cardRect.width;
  } else if (rect.right + gap + cardRect.width <= innerWidth - margin) {
    top = rect.top + rect.height / 2 - cardRect.height / 2;
    left = rect.right + gap;
  } else {
    top = innerHeight - cardRect.height - margin;
    left = innerWidth / 2 - cardRect.width / 2;
  }
  card.style.top = clamp(top, margin, innerHeight - cardRect.height - margin) + 'px';
  card.style.left = clamp(left, margin, innerWidth - cardRect.width - margin) + 'px';
  card.style.visibility = 'visible';
}

function renderStep() {
  if (!layer) return;
  const step = activeSteps[stepIndex];
  layer.querySelector('.tour-progress').textContent =
    'Quick tour · ' + (stepIndex + 1) + ' of ' + activeSteps.length;
  layer.querySelector('.tour-title').textContent = step.title;
  layer.querySelector('.tour-body').textContent = step.body;
  layer.querySelector('.tour-back').disabled = stepIndex === 0;
  layer.querySelector('.tour-next').textContent =
    stepIndex === activeSteps.length - 1 ? 'Finish' : 'Next';
  layer.querySelector('.tour-card').style.visibility = 'hidden';
  requestAnimationFrame(() => {
    positionTour();
    layer && layer.querySelector('.tour-next').focus();
  });
}

function finishTour() {
  try { localStorage.setItem(TOUR_KEY, '1'); } catch {}
  closeTour();
}

function closeTour() {
  if (!layer) return;
  const oldLayer = layer;
  layer = null;
  window.removeEventListener('resize', positionTour);
  document.removeEventListener('keydown', handleTourKeydown, true);
  oldLayer.remove();
  if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  previousFocus = null;
}

function handleTourKeydown(event) {
  if (!layer) return;
  // The tour owns every key while open; do not let editor shortcuts also run.
  event.stopPropagation();
  if ((event.key === 'Enter' || event.key === ' ') &&
      event.target instanceof Element &&
      event.target.closest('.tour-actions button')) {
    event.preventDefault();
    event.target.click();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    finishTour();
    return;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (stepIndex < activeSteps.length - 1) { stepIndex++; renderStep(); }
    else finishTour();
    return;
  }
  if (event.key === 'ArrowLeft' && stepIndex > 0) {
    event.preventDefault();
    stepIndex--;
    renderStep();
    return;
  }
  if (event.key !== 'Tab') {
    return;
  }
  const controls = [...layer.querySelectorAll('button:not([disabled])')];
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function showTour({ force = false } = {}) {
  if (layer) return false;
  if (!force) {
    try { if (localStorage.getItem(TOUR_KEY)) return false; } catch {}
  }
  previousFocus = document.activeElement;
  stepIndex = 0;
  activeSteps = STEPS.filter(targetIsVisible);
  if (!activeSteps.length) activeSteps = STEPS.slice(1);
  layer = document.createElement('div');
  layer.className = 'tour-layer';
  layer.innerHTML = `
    <div class="tour-spotlight" aria-hidden="true"></div>
    <section class="tour-card" role="dialog" aria-modal="true"
             aria-labelledby="tour-title" aria-describedby="tour-body">
      <div class="tour-progress"></div>
      <h2 class="tour-title" id="tour-title"></h2>
      <p class="tour-body" id="tour-body" aria-live="polite"></p>
      <div class="tour-actions">
        <button class="btn tour-skip" type="button">Skip tour</button>
        <button class="btn tour-back" type="button">Back</button>
        <button class="btn primary tour-next" type="button">Next</button>
      </div>
    </section>`;
  document.body.appendChild(layer);
  layer.querySelector('.tour-skip').addEventListener('click', finishTour);
  layer.querySelector('.tour-back').addEventListener('click', () => {
    if (stepIndex > 0) { stepIndex--; renderStep(); }
  });
  layer.querySelector('.tour-next').addEventListener('click', () => {
    if (stepIndex < activeSteps.length - 1) { stepIndex++; renderStep(); }
    else finishTour();
  });
  window.addEventListener('resize', positionTour);
  document.addEventListener('keydown', handleTourKeydown, true);
  renderStep();
  return true;
}
