// slides.md is the deck source, and its shape is the shape of the talk:
//
//   # Deck title
//   ## Slide title
//   - a bullet
//   ::: notes
//   what the narrator says over this slide
//   :::
//
// Every `##` opens a slide; a `::: notes` div inside one is spoken rather than shown, so the
// narration lives next to the slide it belongs to instead of in a second file that drifts.
// The same `:::  notes ` div is what pandoc turns into PowerPoint speaker notes, so the pptx,
// the html deck and the video all come from this one file.
import { renderMarkdown } from './markdown.mjs';

const DECK_HEADING = /^#\s+(.*?)\s*#*\s*$/;
const SLIDE_HEADING = /^##\s+(.*?)\s*#*\s*$/;
const NOTES_OPEN = /^:::\s*\{?\.?notes\}?\s*$/i;
const DIV_CLOSE = /^:::\s*$/;
const FENCE = /^(```+|~~~+)/;
// Top level only, so the outline is a table of contents and not a transcript of every sub-point.
const BULLET = /^[-*+]\s+(.*)$/;

/** `{ title, lead, slides: [{ index, title, html, bullets, notes }] }` */
export function parseSlides(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  let title = '';
  const lead = [];
  const problems = [];
  const slides = [];
  let current = null;
  let notes = null;

  for (const line of lines) {
    if (notes) {
      if (DIV_CLOSE.test(line)) {
        if (current) current.notes = notes.join('\n').trim();
        notes = null;
      } else notes.push(line);
      continue;
    }

    // A `##` inside a fenced block is a shell comment or a diff, not a slide break — the deck in
    // this repository has been one `git diff` away from silently splitting a code slide in half.
    if (current) current.fence = FENCE.test(line) ? !current.fence : current.fence;
    const inFence = current ? current.fence : false;

    if (!inFence && NOTES_OPEN.test(line)) {
      notes = [];
      continue;
    }
    // The notes div is dropped before the heading test so that a `#` comment inside a shell block
    // is not mistaken for the deck title either.
    if (!inFence) {
      const slide = line.match(SLIDE_HEADING);
      if (slide) {
        current = { title: slide[1].trim(), body: [], notes: '', fence: false };
        slides.push(current);
        continue;
      }
    }
    if (current) {
      current.body.push(line);
      const bullet = line.match(BULLET);
      if (bullet) current.bullets = [...(current.bullets ?? []), bullet[1].trim()];
      continue;
    }
    const deckHeading = line.match(DECK_HEADING);
    if (deckHeading && !inFence) {
      title = deckHeading[1].trim();
      continue;
    }
    lead.push(line);
  }

  // An unterminated notes block is the one mistake this format invites, and it is a silent one:
  // everything below it becomes narration and the rest of the deck disappears. So it is carried
  // out as a problem for the caller to print rather than swallowed here.
  if (notes) {
    if (current) current.notes = notes.join('\n').trim();
    problems.push(`a ::: notes block is never closed${slides.length ? ` (in slide ${slides.length}: ${slides[slides.length - 1].title})` : ''}`);
  }

  return {
    title,
    lead: renderMarkdown(lead.join('\n')),
    problems,
    slides: slides.map((slide, index) => ({
      index: index + 1,
      title: slide.title,
      html: renderMarkdown(slide.body.join('\n')),
      bullets: slide.bullets ?? [],
      notes: slide.notes,
    })),
  };
}

/** The outline.json shape: titles and top-level bullets, in order, without any rendering. */
export function slideOutline(source) {
  const deck = parseSlides(source);
  return {
    slides: deck.slides.map((slide) => ({ index: slide.index, title: slide.title, bullets: slide.bullets })),
    total: deck.slides.length,
    problems: deck.problems,
  };
}

/** True when at least one slide carries narration, i.e. the deck can be voiced. */
export function hasNarration(deck) {
  return deck.slides.some((slide) => Boolean(slide.notes));
}
