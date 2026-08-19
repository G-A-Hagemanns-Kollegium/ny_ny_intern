// Den Hurtige's chat behaviour. No-op on every page without #js-feed.
//
// The feed re-renders wholesale every 20 seconds (hx-trigger="every 20s" on #js-feed), which by
// default would throw away the reader's scroll position, collapse any open reply thread and delete
// a half-written reply. Everything here exists to make that poll invisible.
//
// Note the scroll container is #js-feed itself, not the window and not `.main`: the chat shell is
// exactly one viewport tall and only the message list scrolls (see .chat-page in styles.css).

import { hookImageForms } from "./imageupload";

const FEED_ID = "js-feed";
const EDITABLE = new Set(["INPUT", "TEXTAREA", "SELECT"]);
// Treat "within this many px of the bottom" as following the conversation.
const STICK_THRESHOLD = 120;
const TEXTAREA_MAX_ROWS = 5;

interface BeforeSwapDetail {
  target?: HTMLElement;
  shouldSwap?: boolean;
}

const feed = document.getElementById(FEED_ID);
// The list scrolls itself, so these are the same element — kept as two names because they mean
// different things: one is the region being swapped, the other the thing whose scrollTop we keep.
const scroller = feed;

function isEditing(container: HTMLElement): boolean {
  const active = document.activeElement;
  if (!active || !container.contains(active)) return false;
  return EDITABLE.has(active.tagName) || (active as HTMLElement).isContentEditable;
}

function atBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
}

function toBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight;
}

// ---- CSRF ------------------------------------------------------------------------------------
// htmx does not add Django's CSRF header by itself, and the reaction buttons are the project's
// first hx-post. Registered globally rather than per-element so every future hx-post is covered.
function csrfToken(): string {
  const cookie = document.cookie.split("; ").find((c) => c.startsWith("csrftoken="));
  if (cookie) return decodeURIComponent(cookie.slice("csrftoken=".length));
  // Fallback for CSRF_USE_SESSIONS or a missing cookie: any rendered {% csrf_token %} input.
  return document.querySelector<HTMLInputElement>('input[name="csrfmiddlewaretoken"]')?.value ?? "";
}

document.body.addEventListener("htmx:configRequest", (event: Event) => {
  const detail = (event as CustomEvent<{ headers: Record<string, string> }>).detail;
  detail.headers["X-CSRFToken"] = csrfToken();
});

if (feed && scroller) {
  // Start at the newest message, as a chat does.
  toBottom(scroller);
  window.addEventListener("load", () => toBottom(scroller));

  let wasAtBottom = true;
  let savedScrollTop = 0;
  let openThreads: string[] = [];

  document.body.addEventListener("htmx:beforeSwap", (event: Event) => {
    const detail = (event as CustomEvent<BeforeSwapDetail>).detail;
    if (detail?.target?.id !== FEED_ID) return; // a reaction swap, or some other region

    // Never replace the DOM someone is typing into — it would discard the text.
    if (isEditing(feed)) {
      detail.shouldSwap = false;
      return;
    }
    wasAtBottom = atBottom(scroller);
    savedScrollTop = scroller.scrollTop;
    // Only reply threads: an emoji picker left open should not be resurrected by a poll.
    openThreads = Array.from(feed.querySelectorAll<HTMLDetailsElement>("details.thread[open]")).map(
      (d) => d.id,
    );
  });

  document.body.addEventListener("htmx:afterSwap", (event: Event) => {
    const target = (event as CustomEvent<{ target?: HTMLElement }>).detail?.target;
    if (target?.id !== FEED_ID) return;

    // Re-open whatever was expanded, or reading a thread would be interrupted every 20 seconds.
    for (const id of openThreads) {
      const details = document.getElementById(id);
      if (details instanceof HTMLDetailsElement) details.open = true;
    }
    // Reply forms are new DOM, so re-arm the client-side image downscaler on them.
    hookImageForms(feed);
    // Follow the conversation only if they were already at the bottom; otherwise leave the reader
    // exactly where they were rather than yanking them down mid-sentence.
    if (wasAtBottom) toBottom(scroller);
    else scroller.scrollTop = savedScrollTop;
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
// <details> has no concept of "click away to dismiss", so a picker would otherwise stay open behind
// whatever you did next, and two could be open at once.
document.addEventListener("click", (event) => {
  const target = event.target as Node;
  for (const picker of document.querySelectorAll<HTMLDetailsElement>("details.emoji-picker[open]")) {
    if (!picker.contains(target)) picker.open = false;
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
