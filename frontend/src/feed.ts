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
//
// There are TWO pollers on this page. #js-feed polls the message list; a thread panel, once open,
// polls itself (see _thread.html). They are separate because the panel must NOT live inside the
// morphed region -- and merging them into one request with an out-of-band swap would put every
// reply back into the 5s payload, which is exactly what moving replies into the panel removed.

import { Idiomorph } from "idiomorph/htmx";

const FEED_ID = "js-feed";
const THREAD_ID = "js-thread";
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
//   open   a picker or reader panel the reader opened; losing it closes it under their thumb
const CLIENT_OWNED_ATTRS = new Set(["open"]);

Idiomorph.defaults.ignoreActiveValue = true; // never rewrite the field being typed into
Idiomorph.defaults.callbacks.beforeAttributeUpdated = (name: string): boolean =>
  !CLIENT_OWNED_ATTRS.has(name);

// Subtrees the client owns OUTRIGHT: morphing must not enter them at all.
//
// Marked with data-morph-skip in _thread.html rather than listed by selector here, so the template
// that owns the form is the thing that says so.
Idiomorph.defaults.callbacks.beforeNodeMorphed = (node: Node): boolean =>
  !(node instanceof Element) || !node.hasAttribute("data-morph-skip");

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

    // Nothing to re-arm for image uploads any more: imageupload.ts listens on the document in the
    // capture phase, so it already covers forms that did not exist when it was registered.
    //
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
    return;
  }
  closeThread();
});

// ---- thread panel -----------------------------------------------------------------------------
// The panel itself is server-rendered and htmx-driven: the "N svar" anchor in _message.html does
// hx-get into #js-thread, and the fragment that lands there brings its own poll. What is left for
// this file is the four things htmx has no opinion about: closing it, focus, Escape, and making the
// system back gesture close it instead of leaving the app.

const threadHost = document.getElementById(THREAD_ID);

// Where focus came from, so it can be handed back. Not derived from the panel's data-thread-pk at
// close time: that message may have expired out of the feed while the thread was open.
let threadOpener: HTMLElement | null = null;

function threadPanel(): HTMLElement | null {
  return threadHost?.querySelector(".thread-panel") ?? null;
}

function clearThread(): void {
  if (threadHost) threadHost.innerHTML = "";
  dropThreadParam(); // so a reload does not re-open a thread the reader closed
  const opener = threadOpener;
  threadOpener = null;
  // Back to the link that opened it, if it is still on screen; otherwise the feed, so focus never
  // ends up on <body> with nothing to arrow away from.
  if (opener?.isConnected) opener.focus();
  else feed?.focus();
}

// Whether THIS document pushed a history entry when the thread was opened. False when the page was
// loaded straight at ?traad=<pk> (a notification deep link): there is no earlier entry of ours to
// go back to, and calling history.back() would leave the page — in the installed PWA, the app.
let pushedThreadEntry = false;

function dropThreadParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("traad")) return;
  url.searchParams.delete("traad");
  history.replaceState(null, "", url);
}

function closeThread(): void {
  if (!threadPanel()) return;
  if (pushedThreadEntry) {
    // Unwind our own entry so the back stack does not fill with threads already dismissed. The
    // popstate handler below does the actual clearing.
    history.back();
    return;
  }
  // Deep-linked open: nothing of ours to go back to. Clear in place, and take ?traad with it, or a
  // reload would re-open the thread the reader just closed.
  dropThreadParam();
  clearThread();
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("[data-thread-close]")) {
    event.preventDefault();
    closeThread();
  } else {
    // Remember the opener BEFORE htmx swaps, while the click target still exists.
    const opener = target.closest<HTMLElement>(".msg-replies");
    if (opener) threadOpener = opener;
  }
});

document.body.addEventListener("htmx:afterSwap", (event: Event) => {
  const target = (event as CustomEvent<{ target?: HTMLElement }>).detail?.target;
  if (target?.id !== THREAD_ID) return;
  const panel = threadPanel();
  if (!panel) return;

  // Focus the PANEL, not the reply field. On a phone this is a full-screen view, and focusing the
  // input pops the keyboard over the replies the reader just came to read.
  panel.focus();

  // One history entry per thread, so Android's back gesture closes the panel rather than leaving
  // the installed PWA (the manifest is display:standalone, so there is no browser back button and
  // no other way out of a full-screen view).
  //
  // Hand-rolled rather than hx-push-url: htmx would also snapshot this page into localStorage for
  // its history cache and, on back, restore a DOM that has been polling for minutes. Turning that
  // off needs hx-history="false" on <body>, which makes every back press a full navigation.
  // DO NOT add hx-push-url to the "N svar" link.
  const pk = panel.getAttribute("data-thread-pk");
  if (!pk || history.state?.denHurtigeThread === pk) return;

  const url = new URL(window.location.href);
  const deepLinked = url.searchParams.get("traad") === pk && !threadOpener;
  url.searchParams.set("traad", pk);
  if (deepLinked) {
    // Arrived here with the thread already in the URL, so this is the entry the reader came from,
    // not one we created. Stamp our state onto it rather than stacking a duplicate.
    history.replaceState({ denHurtigeThread: pk }, "", url);
  } else {
    history.pushState({ denHurtigeThread: pk }, "", url);
    pushedThreadEntry = true;
  }
});

window.addEventListener("popstate", (event) => {
  const state = event.state as { denHurtigeThread?: string } | null;
  if (!state?.denHurtigeThread) {
    pushedThreadEntry = false;
    clearThread();
  }
});

// ---- who reacted ------------------------------------------------------------------------------
// Holding a reaction pill (touch), hovering it (mouse), right-clicking it or pressing Shift+Enter
// answers "who used THAT emoji". It replaced a 👥 pill that listed everyone: see the comment at the
// top of _reactions.html for why per-emoji, and why the pill went.
//
// Two presentations, because one would be wrong for one of the inputs:
//
//   touch / right-click / keyboard -> the <details class="pop"> sheet already rendered in the row.
//   mouse hover                    -> a lightweight tooltip appended to <body>.
//
// Hover must NOT open the .pop. A .pop draws a full-screen `.pop-backdrop`, so the moment it opened
// the backdrop would slide under the cursor, fire pointerout on the pill, close the panel, and
// re-open on the next pointerover — a flicker loop. Hover also has no business summoning a centred
// modal sheet. The tooltip reads its names straight out of that same panel's DOM, so there is still
// exactly one rendering of who reacted and it cannot drift.
//
// The tooltip is a direct child of <body> and position:fixed, so nothing can clip it and no
// ancestor can trap it — the same reasoning as the .pop panels themselves (see styles.css).
//
// All of it is delegated from `document`, and keyed on `.reaction[data-who]` rather than on
// anything Den Hurtige owns. Two reasons, both load-bearing: the feed's pills are morphed every few
// seconds, so anything bound to a pill directly would have to be re-armed after every poll — and
// opslagstavlen renders the same markup on a page this module knows nothing about, which is why
// giving the noticeboard these gestures needed no code here beyond the window-scroll line below.
const WHO_HOLD_MS = 450; // long-press
const WHO_HOVER_MS = 400;
const WHO_MOVE_SLOP = 10; // px of finger drift that still counts as a hold, not a scroll
const canHover = window.matchMedia("(hover: hover)").matches;

let holdTimer: number | undefined;
let hoverTimer: number | undefined;
let holdOrigin: { x: number; y: number } | null = null;
// A long-press ends in a click, and that click would otherwise toggle the reaction AND be read as
// an outside click by the dismissal handler above — opening the panel and closing it in one go.
let swallowClick = false;
let tip: HTMLDivElement | null = null;

function pillPanel(pill: Element): HTMLDetailsElement | null {
  const id = pill.getAttribute("data-who");
  return id ? (document.getElementById(id) as HTMLDetailsElement | null) : null;
}

function whoNames(pill: Element): string[] {
  const panel = pillPanel(pill);
  if (!panel) return [];
  return [...panel.querySelectorAll(".who-names")]
    .map((n) => n.textContent?.trim() ?? "")
    .filter(Boolean);
}

function openWhoPanel(pill: Element): void {
  const panel = pillPanel(pill);
  if (!panel || !whoNames(pill).length) return;
  // Only one overlay at a time, matching what the click-away handler enforces for the rest.
  for (const other of document.querySelectorAll<HTMLDetailsElement>("details.pop[open]")) {
    if (other !== panel) other.open = false;
  }
  panel.open = true;
}

function hideTip(): void {
  if (tip) tip.hidden = true;
}

function showTip(pill: HTMLElement): void {
  const names = whoNames(pill);
  if (!names.length) return;
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "who-tip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
  }
  tip.textContent = names.join(", ");
  tip.hidden = false;

  // Measured after it is visible and filled, because both change its size. Prefers above the pill
  // and flips below when there is no room; clamped horizontally so a pill near either edge still
  // shows the whole list.
  const pillBox = pill.getBoundingClientRect();
  const tipBox = tip.getBoundingClientRect();
  const gap = 6;
  const above = pillBox.top - tipBox.height - gap;
  tip.style.top = `${above >= 4 ? above : pillBox.bottom + gap}px`;
  const wanted = pillBox.left + pillBox.width / 2 - tipBox.width / 2;
  tip.style.left = `${Math.max(6, Math.min(wanted, window.innerWidth - tipBox.width - 6))}px`;
}

function pillFrom(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(".reaction[data-who]") : null;
}

if (canHover) {
  document.addEventListener("pointerover", (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const pill = pillFrom(event.target);
    if (!pill) return;
    window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => showTip(pill), WHO_HOVER_MS);
  });

  document.addEventListener("pointerout", (event: PointerEvent) => {
    if (!pillFrom(event.target)) return;
    window.clearTimeout(hoverTimer);
    hideTip();
  });
}

// The tooltip is positioned against the viewport, so anything that moves the pill must retire it
// rather than leave it floating somewhere the pill no longer is. Both scrollers are covered because
// the two callers scroll differently: Den Hurtige's chat shell scrolls #js-feed itself (see the
// note at the top of this file), while opslagstavlen is an ordinary page that scrolls the window.
// Listening only to the first left a tooltip hanging mid-screen as the noticeboard scrolled under it.
feed?.addEventListener("scroll", hideTip, { passive: true });
window.addEventListener("scroll", hideTip, { passive: true });
window.addEventListener("resize", hideTip);

document.addEventListener("pointerdown", (event: PointerEvent) => {
  const pill = pillFrom(event.target);
  if (!pill || event.pointerType === "mouse") return; // mouse gets hover and right-click instead
  holdOrigin = { x: event.clientX, y: event.clientY };
  window.clearTimeout(holdTimer);
  holdTimer = window.setTimeout(() => {
    swallowClick = true;
    openWhoPanel(pill);
  }, WHO_HOLD_MS);
});

function cancelHold(): void {
  window.clearTimeout(holdTimer);
  holdOrigin = null;
}

document.addEventListener("pointerup", cancelHold);
document.addEventListener("pointercancel", cancelHold);
document.addEventListener("pointermove", (event: PointerEvent) => {
  // A finger that has travelled is scrolling the feed, not holding a pill.
  if (!holdOrigin) return;
  if (
    Math.abs(event.clientX - holdOrigin.x) > WHO_MOVE_SLOP ||
    Math.abs(event.clientY - holdOrigin.y) > WHO_MOVE_SLOP
  ) {
    cancelHold();
  }
});

// Capture phase, so it runs before both htmx's handler on the pill and the click-away handler above.
document.addEventListener(
  "click",
  (event: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  },
  true,
);

document.addEventListener("contextmenu", (event: MouseEvent) => {
  const pill = pillFrom(event.target);
  if (!pill || !whoNames(pill).length) return;
  event.preventDefault();
  hideTip();
  openWhoPanel(pill);
});

// Enter and Space must keep toggling the reaction — that is the pill's primary job and the only
// keyboard way to react. Shift+Enter is the second gesture, mirroring hold and right-click.
document.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key !== "Enter" || !event.shiftKey) return;
  const pill = pillFrom(event.target);
  if (!pill) return;
  event.preventDefault();
  openWhoPanel(pill);
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
