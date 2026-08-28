// Web Push subscribe/unsubscribe. No-op on every page without a [data-push] element.
//
// Shared by Den Hurtige and opslagstavlen. A browser has exactly ONE push subscription per
// service-worker registration, so the *browser* subscription is not per feature — consent is,
// and the server tracks it per topic. Two consequences drive the code below:
//   * the button's initial state cannot come from getSubscription(): that says whether this
//     browser is subscribed at all, not whether it wants THIS topic. The page tells us instead.
//   * opting out of one topic must NOT call subscription.unsubscribe(), or the other topic
//     silently stops arriving. Only the server knows whether anything is left, so it says so.
//
// Written by hand rather than using django-webpush's {% webpush_button %}, which would not work
// here: its webpush.js registers a SECOND service worker under /webpush/ (so the push handler in
// templates/sw.js never runs), it never calls Notification.requestPermission() — which iOS Safari
// requires from a user gesture or subscribe() rejects — and its labels are hardcoded English.
//
// Failures are reported to the user by cause, not as one generic "something broke": every step here
// fails for a reason a resident or an admin can act on (permission blocked, key misconfigured,
// server rejected), and a dead-end message makes those indistinguishable.

const IOS = /iP(hone|ad|od)/.test(navigator.userAgent);

/** Brave ships an official detection hook; every other browser leaves `navigator.brave` undefined. */
interface BraveNavigator extends Navigator {
  brave?: { isBrave: () => Promise<boolean> };
}

async function isBrave(): Promise<boolean> {
  try {
    return (await (navigator as BraveNavigator).brave?.isBrave()) === true;
  } catch {
    return false;
  }
}

// An uncompressed P-256 point: 0x04 followed by the 32-byte X and Y coordinates.
const VAPID_KEY_BYTES = 65;
const UNCOMPRESSED_POINT_TAG = 0x04;

class ServerRejected extends Error {
  constructor(readonly status: number) {
    super(`server svarede ${status}`);
  }
}

class BadVapidKey extends Error {}

// A base64url VAPID key has to reach pushManager.subscribe as raw bytes. The buffer is allocated
// explicitly so the result is Uint8Array<ArrayBuffer>: BufferSource excludes SharedArrayBuffer, and
// Uint8Array.from() would widen it to ArrayBufferLike.
function urlB64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  let raw: string;
  try {
    raw = atob(padded);
  } catch {
    // atob throws InvalidCharacterError on e.g. a PEM body pasted into VAPID_PUBLIC_KEY.
    throw new BadVapidKey("nøglen er ikke gyldig base64url");
  }
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  // Checked here rather than left to the browser: Chrome reports a wrong-shaped key as a generic
  // AbortError from subscribe(), which is indistinguishable from a push-service outage.
  if (bytes.length !== VAPID_KEY_BYTES || bytes[0] !== UNCOMPRESSED_POINT_TAG) {
    throw new BadVapidKey(`nøglen er ${bytes.length} bytes, forventede ${VAPID_KEY_BYTES}`);
  }
  return bytes;
}

function browserName(): string {
  const m = navigator.userAgent.match(/(firefox|edg|chrome|safari|trident|msie)/i);
  return m ? m[0].toLowerCase() : "other";
}

async function post(
  url: string,
  csrf: string,
  statusType: "subscribe" | "unsubscribe",
  topic: string,
  subscription: PushSubscription,
): Promise<{ remaining_topics?: number }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrf },
    credentials: "same-origin",
    body: JSON.stringify({
      status_type: statusType,
      topic,
      subscription: subscription.toJSON(),
      browser: browserName(),
      user_agent: navigator.userAgent,
    }),
  });
  if (!response.ok) throw new ServerRejected(response.status);
  // 201 (subscribe) has no body; 202 (unsubscribe) reports how many topics this device still wants.
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function subscribeTo(
  registration: ServiceWorkerRegistration,
  vapidKey: string,
): Promise<PushSubscription> {
  const options: PushSubscriptionOptionsInit = {
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(vapidKey),
  };
  try {
    return await registration.pushManager.subscribe(options);
  } catch (err) {
    // A subscription created under a DIFFERENT VAPID key blocks a new one with InvalidStateError,
    // and the stale one is undecryptable by the current server. This is the normal state of any
    // browser that subscribed before the key pair was set or changed, so recover instead of asking
    // the user to clear site data.
    if (err instanceof DOMException && err.name === "InvalidStateError") {
      const stale = await registration.pushManager.getSubscription();
      if (stale) await stale.unsubscribe();
      return await registration.pushManager.subscribe(options);
    }
    throw err;
  }
}

function explain(err: unknown, brave: boolean): string {
  if (err instanceof BadVapidKey) {
    return `Serverens notifikationsnøgle er forkert konfigureret (${err.message}). Kontakt en administrator.`;
  }
  if (err instanceof ServerRejected) {
    return err.status === 403
      ? "Din session er udløbet. Genindlæs siden og prøv igen."
      : `Serveren afviste abonnementet (${err.status}). Prøv igen senere.`;
  }
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") return "Browseren blokerer notifikationer for denne side.";
    if (err.name === "AbortError") {
      // Chrome's wording is "Registration failed - push service error": the browser could not reach
      // its own push backend (FCM for Chrome/Edge/Brave). Two realistic causes, and the fix differs
      // completely, so they get separate messages.
      //
      // Brave ships with Google push messaging OFF by default, which makes this the *normal* first
      // experience for every Brave user — worth naming the exact setting rather than making them
      // guess. Verified against brave://gcm-internals: the GCM client initialises but never checks
      // in (empty Android Id, "Connection Client Created: false").
      return brave
        ? "Brave blokerer notifikationer som standard. Slå 'Use Google services for push messaging' " +
            "til under brave://settings/privacy og genstart Brave."
        : "Browseren kunne ikke tilmelde sig sin notifikationstjeneste. Det skyldes typisk " +
            "netværket — prøv et andet netværk, eller en anden browser.";
    }
    return `Browseren afviste abonnementet (${err.name}).`;
  }
  return `Noget gik galt: ${err instanceof Error ? err.message : String(err)}`;
}

async function init(root: HTMLElement): Promise<void> {
  const button = root.querySelector<HTMLButtonElement>("[data-push-button]");
  const message = root.querySelector<HTMLElement>("[data-push-message]");
  const csrf = root.querySelector<HTMLInputElement>('input[name="csrfmiddlewaretoken"]')?.value ?? "";
  const saveUrl = root.dataset.url ?? "";
  const vapidKey = root.dataset.vapidKey ?? "";
  const topic = root.dataset.topic ?? "den_hurtige";
  // Whether the server has this device opted in to THIS topic. Rendered by the page, because the
  // browser cannot know it: one endpoint serves every topic. Absent/empty => not subscribed.
  const wantsTopic = root.dataset.subscribed === "1";
  // Danish copy lives in the template, so all user-facing text stays where the rest of it is.
  const onLabel = root.dataset.onLabel ?? "Slå notifikationer til";
  const offLabel = root.dataset.offLabel ?? "Slå notifikationer fra";
  // Narrow-screen wording for the same action. The full label sits next to a long channel name
  // and the per-channel bell, and the three together overflowed a phone — which silently turned
  // the chat header into two rows and took that height off the feed.
  const offLabelShort = root.dataset.offLabelShort ?? offLabel;
  const successText = root.dataset.successText ?? "Du får nu besked.";
  // "på denne enhed" because that is what it means: consent is per topic, but a push subscription is
  // per browser, so turning it off here does not touch your other devices.
  const offText = root.dataset.offText ?? "Notifikationer er slået fra på denne enhed.";
  if (!button || !message) return;

  const say = (text: string): void => {
    message.textContent = text;
    message.hidden = false;
  };

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    // On iOS this is the normal state in a browser tab: push only exists in the installed PWA.
    say(
      IOS
        ? "Tilføj siden til hjemmeskærmen (Del → Føj til hjemmeskærm) for at kunne få notifikationer."
        : "Din browser understøtter ikke notifikationer.",
    );
    return;
  }
  if (!vapidKey) {
    say("Notifikationer er ikke sat op på serveren endnu.");
    return;
  }
  if (Notification.permission === "denied") {
    say("Notifikationer er blokeret i browserens indstillinger for denne side.");
    return;
  }

  const brave = await isBrave();
  const registration = await navigator.serviceWorker.ready; // the root-scoped /sw.js from base.html
  let subscription = await registration.pushManager.getSubscription();
  // The button reflects consent to this topic, not the existence of a browser subscription: a
  // device subscribed to the other feature must still show "on" as an option here.
  let enabled = wantsTopic && subscription !== null;

  // Two different controls now live in this header, and they are not alternatives: this one is per
  // *device* (does this browser receive push at all), while the bell next to it is per *channel*
  // for the whole resident. Unsubscribed, this is the call to action and gets the prominent button.
  // Subscribed, it steps back to a quiet link — the granular control people actually reach for is
  // the channel bell, and two equally loud buttons side by side read as one control with a bug.
  //
  // It is demoted rather than removed, for two reasons. Channel mutes are per resident, so without
  // this there is no way to keep push on your phone but off on a shared browser you logged into
  // once. And turning notifications off in the OS/browser settings instead does NOT delete the
  // server's subscription: the endpoint stays alive, so the server keeps encrypting and sending to
  // it forever and never sees the 410 that would reap the row. This path calls unsubscribe() and
  // deletes it.
  const label = (cls: string, text: string): HTMLSpanElement => {
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    return span;
  };

  const render = (): void => {
    // Both wordings are rendered and CSS shows one (see .label-long/.label-short): the button text
    // is set from JS, so a media query cannot reach it any other way, and matchMedia here would
    // have to be re-run on every resize and orientation change.
    button.textContent = "";
    button.append(
      label("label-long", enabled ? offLabel : onLabel),
      label("label-short", enabled ? offLabelShort : onLabel),
    );
    // Styling hook for the "already on" state. Keyed on topic consent, not on the browser
    // subscription: a device subscribed for the *other* feature must not look enabled here.
    button.classList.toggle("is-quiet", enabled);
    button.disabled = false;
    button.hidden = false;
  };
  render();

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (enabled && subscription) {
        const result = await post(saveUrl, csrf, "unsubscribe", topic, subscription);
        // Release the BROWSER subscription only once no topic wants this device any more. Doing it
        // unconditionally is how turning one feature off would silently kill the other, with a
        // symptom ("notifications just stopped") invisible from the server.
        if ((result.remaining_topics ?? 0) === 0) {
          await subscription.unsubscribe();
          subscription = null;
        }
        enabled = false;
        say(offText);
      } else {
        // Must come before subscribe() and must be inside the click handler — Safari/iOS rejects
        // a subscribe() whose permission prompt is not tied to a user gesture.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          say("Du afviste notifikationer. Slå dem til i browserens indstillinger for at fortryde.");
          button.disabled = false;
          return;
        }
        // Reuse the browser's existing subscription when it has one: it is shared with the other
        // topic, and re-subscribing would hand us the same endpoint anyway.
        const fresh = subscription ?? (await subscribeTo(registration, vapidKey));
        try {
          await post(saveUrl, csrf, "subscribe", topic, fresh);
        } catch (err) {
          // Never leave the browser holding a subscription the server does not know about: it would
          // make the button read "slå fra" while no notification could ever arrive. Only safe to
          // release one we just created — an existing one may be serving the other topic.
          if (!subscription) await fresh.unsubscribe();
          throw err;
        }
        subscription = fresh;
        enabled = true;
        say(successText);
      }
    } catch (err) {
      console.error(`push (${topic}):`, err);
      say(explain(err, brave));
    }
    render();
  });
}

// One widget per page in practice, but selected as a list so a page could carry both toggles.
for (const root of Array.from(document.querySelectorAll<HTMLElement>("[data-push]"))) {
  init(root).catch((err) => console.error("push init:", err));
}
