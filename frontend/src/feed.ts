// Den Hurtige's live feed polls itself every 20 seconds (see templates/den_hurtige/feed.html).
// The polled region contains a comment box per post, so an unguarded swap would replace the DOM
// node the user is typing into and silently discard the text. Skip the swap whenever focus is
// inside the feed; the next poll picks the update up as soon as they click away.
//
// No-op on every page without #js-feed.

const FEED_ID = "js-feed";
const EDITABLE = new Set(["INPUT", "TEXTAREA", "SELECT"]);

interface BeforeSwapDetail {
  target?: HTMLElement;
  shouldSwap?: boolean;
}

function isEditing(container: HTMLElement): boolean {
  const active = document.activeElement;
  if (!active || !container.contains(active)) return false;
  return EDITABLE.has(active.tagName) || (active as HTMLElement).isContentEditable;
}

document.body.addEventListener("htmx:beforeSwap", (event: Event) => {
  const detail = (event as CustomEvent<BeforeSwapDetail>).detail;
  const target = detail?.target;
  if (!target || target.id !== FEED_ID) return; // some other htmx region on the page
  if (isEditing(target)) detail.shouldSwap = false;
});
