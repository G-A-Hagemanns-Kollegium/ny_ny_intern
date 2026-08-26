// Den Hurtige's chat behaviour. No-op on every page without #js-feed.
//
// The feed polls every 5 seconds and the response is MORPHED into the DOM rather than replacing it
// (hx-swap="morph:innerHTML" on #js-feed, idiomorph). That choice is what deleted most of this
// file. The poll used to run every 20s and replace the list wholesale, so it threw away the
// reader's scroll position, collapsed open reply threads and deleted half-written replies — and
// roughly forty lines here existed to defend against its own refresh: cancel the swap while
// someone was typing, snapshot scrollTop, record which threads were open and re-open them after.
// Morphing patches the existing nodes in place instead, so none of that is needed: what did not
// change is not touched. The response is still the whole list, which is why deletions, expiry,
// reaction counts and new replies all keep working for free.
//
// Note the scroll container is #js-feed itself, not the window and not `.main`: the chat shell is
// exactly one viewport tall and only the message list scrolls (see .chat-page in styles.css).
//
// The site-wide htmx X-CSRFToken hook used to live here; it is now ./htmx-csrf, imported from
// main.ts, because opslagstavlen's hx-posts depend on it too.

import { Idiomorph } from "idiomorph/htmx";

import { hookImageForms } from "./imageupload";

const FEED_ID = "js-feed";
// Treat "within this many px of the bottom" as following the conversation.
const STICK_THRESHOLD = 120;
const TEXTAREA_MAX_ROWS = 5;

interface BeforeSwapDetail {
  target?: HTMLElement;
}

const feed = document.getElementById(FEED_ID);
// The list scrolls itself, so these are the same element — kept as two names because they mean
// different things: one is the region being swapped, the other the thing whose scrollTop we keep.
const scroller = feed;

function atBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
}

function toBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
}

// Attributes the CLIENT owns, which the server never sends and morphing would therefore strip:
//   open              a reply thread or picker the reader opened; losing it re-collapses it
//   data-img-hooked   imageupload.ts's "already wired" marker. Strip it and the next hook call
//                     re-arms the same form, stacking a second listener on every poll.
const CLIENT_OWNED_ATTRS = new Set(["open", "data-img-hooked"]);

Idiomorph.defaults.ignoreActiveValue = true; // never rewrite the field being typed into
Idiomorph.defaults.callbacks.beforeAttributeUpdated = (name: string): boolean =>
  !CLIENT_OWNED_ATTRS.has(name);

if (feed && scroller) {
  // Start at the newest message, as a chat does.
  toBottom(scroller);
  window.addEventListener("load", () => toBottom(scroller));

  let wasAtBottom = true;

  document.body.addEventListener("htmx:beforeSwap", (event: Event) => {
    const detail = (event as CustomEvent<BeforeSwapDetail>).detail;
    if (detail?.target?.id !== FEED_ID) return; // a reaction swap, or some other region
    wasAtBottom = atBottom(scroller);
  });

  document.body.addEventListener("htmx:afterSwap", (event: Event) => {
    const target = (event as CustomEvent<{ target?: HTMLElement }>).detail?.target;
    if (target?.id !== FEED_ID) return;

    // Only forms morphing added are unhooked; the marker above keeps the rest from re-arming.
    hookImageForms(feed);
    // Follow the conversation only if they were already at the bottom. No scrollTop to restore
    // otherwise: morphing leaves the surrounding nodes alone, so the position does not move.
    if (wasAtBottom) toBottom(scroller);
  });
}

// ---- zoom lockdown (iOS) ---------------------------------------------------------------------
// Safari has ignored `user-scalable=no` since iOS 10, on purpose, so the viewport meta in feed.html
// only covers Android and desktop. Pinch-zoom on iOS is a Safari-specific gesture event, and
// preventing it is the one thing that actually stops it. Double-tap zoom is handled in CSS by
// `.no-zoom { touch-action: manipulation }`, and focus-zoom by keeping inputs at 16px.
//
// Scoped to this page: the rest of intern keeps pinch-to-zoom, which people need on the alumneliste
// and long CMS pages. Disabling it site-wide would be a real accessibility regression.
if (document.body.classList.contains("no-zoom")) {
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, (event: Event) => event.preventDefault(), { passive: false });
  }
}

// ---- emoji picker ---------------------------------------------------------------------------
// <details> has no concept of "click away to dismiss", so a panel would otherwise stay open behind
// whatever you did next, and two could be open at once.
//
// The test is "outside the PANEL", not "outside the <details>". The reaction overlays put a
// full-screen backdrop *inside* their own <details> (it has to be a real element — a click on a
// ::before pseudo-element reports the originating element as its target), so a `details.contains`
// check would treat a tap on the backdrop as a tap inside the picker and never close it. Excluding
// the summary keeps the browser's own toggle working: without it, the tap that opens a panel would
// be seen as an outside click on the panel and shut it again immediately.
const DISMISSABLE = "details.pop[open], details.channel-picker[open]";
const PANELS = ":scope > .pop-panel, :scope > .channel-menu";

document.addEventListener("click", (event) => {
  const target = event.target as Node;
  for (const picker of document.querySelectorAll<HTMLDetailsElement>(DISMISSABLE)) {
    const summary = picker.querySelector(":scope > summary");
    if (summary?.contains(target)) continue;
    const panel = picker.querySelector(PANELS);
    if (panel?.contains(target)) continue;
    picker.open = false;
  }
});

// Escape closes the topmost open panel, which is what a modal-looking overlay is expected to do and
// the only way out for anyone not using a pointer.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const open = document.querySelectorAll<HTMLDetailsElement>(DISMISSABLE);
  const last = open[open.length - 1];
  if (last) {
    last.open = false;
    last.querySelector<HTMLElement>(":scope > summary")?.focus();
  }
});

// ---- composer --------------------------------------------------------------------------------
const composer = document.getElementById("js-composer");
if (composer instanceof HTMLFormElement) {
  const textarea = composer.querySelector("textarea");
  const fileInput = composer.querySelector<HTMLInputElement>('input[type="file"]');
  const fileNote = document.getElementById("js-composer-file");

  if (textarea) {
    const grow = (): void => {
      const max = parseFloat(getComputedStyle(textarea).lineHeight || "20") * TEXTAREA_MAX_ROWS;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, max)}px`;
    };
    textarea.addEventListener("input", grow);
    grow();

    // Plain Enter must stay a newline: on a phone it is the only way to write a second line.
    textarea.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        composer.requestSubmit();
      }
    });
  }

  // Confirm the attachment landed — a file input styled as a paperclip gives no other feedback.
  if (fileInput && fileNote) {
    fileInput.addEventListener("change", () => {
      const name = fileInput.files?.[0]?.name;
      fileNote.textContent = name ? `📎 ${name}` : "";
      fileNote.hidden = !name;
    });
  }
}
