import type Alpine from "alpinejs";
import { DEMO_HAGEMANN_CHALLENGE } from "./challenges";
import {
  createReplayBypass,
  initialSessionState,
  isExactImageSelection,
  shouldTrigger,
  type GahkchaSessionState,
} from "./core.js";

type EligibleElement = HTMLAnchorElement | HTMLButtonElement;
type GahkchaModal = {
  open: boolean;
  challenge: typeof DEMO_HAGEMANN_CHALLENGE;
  selectedIndexes: number[];
  failedImageIndexes: number[];
  feedback: string;
  succeeded: boolean;
  toggle(index: number): void;
  markImageFailed(index: number): void;
  confirm(): void;
  skip(): void;
};

const SESSION_STORAGE_KEY = "gahkcha-session-v1";
const SUCCESS_CLOSE_DELAY_MS = 850;

function readSessionState(): GahkchaSessionState {
  try {
    const saved = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) return { ...initialSessionState(), ...JSON.parse(saved) };
  } catch {
    // Private browsing or storage policy can deny access; the in-memory copy still works.
  }
  return initialSessionState();
}

function persistSessionState(state: GahkchaSessionState): void {
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Session-local in-memory state is an intentional fallback.
  }
}

function isEligibleElement(element: Element): element is EligibleElement {
  return (element instanceof HTMLAnchorElement && element.hasAttribute("href"))
    || element instanceof HTMLButtonElement;
}

function hasHtmxAction(element: HTMLButtonElement): boolean {
  return element.hasAttribute("hx-get")
    || element.hasAttribute("hx-post")
    || element.form?.hasAttribute("hx-get") === true
    || element.form?.hasAttribute("hx-post") === true;
}

export function initGahkcha(AlpineInstance: typeof Alpine): void {
  let modal: GahkchaModal | undefined;
  let pendingElement: EligibleElement | undefined;
  let restoreFocusTo: HTMLElement | undefined;
  let closeTimer: number | undefined;
  const sessionState = readSessionState();
  const replayBypass = createReplayBypass();

  const replayOriginalAction = (): void => {
    const element = pendingElement;
    pendingElement = undefined;
    if (!element || !element.isConnected) return;

    replayBypass.run(element, () => {
      if (element instanceof HTMLButtonElement && element.type === "submit" && element.form && !hasHtmxAction(element)) {
        element.form.requestSubmit(element);
      } else {
        // Element.click() retains ordinary link/button semantics and lets HTMX see its normal event.
        element.click();
      }
    });
  };

  const closeModal = (continueAction: boolean): void => {
    if (!modal) return;
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    closeTimer = undefined;
    modal.open = false;
    window.setTimeout(() => restoreFocusTo?.focus(), 0);
    if (continueAction) replayOriginalAction();
    else pendingElement = undefined;
  };

  const focusDialog = (): void => {
    document.querySelector<HTMLElement>("[data-gahkcha-dialog]")?.focus();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (!modal?.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal(true);
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = document.querySelector<HTMLElement>("[data-gahkcha-dialog]");
    const focusable = dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  AlpineInstance.data("gahkchaModal", () => ({
    open: false,
    challenge: DEMO_HAGEMANN_CHALLENGE,
    selectedIndexes: [],
    failedImageIndexes: [],
    feedback: "",
    succeeded: false,
    init(this: GahkchaModal) {
      modal = this;
      window.addEventListener("keydown", onKeydown);
    },
    toggle(this: GahkchaModal, index: number) {
      if (this.succeeded) return;
      this.selectedIndexes = this.selectedIndexes.includes(index)
        ? this.selectedIndexes.filter((selected) => selected !== index)
        : [...this.selectedIndexes, index];
      this.feedback = "";
    },
    markImageFailed(this: GahkchaModal, index: number) {
      if (!this.failedImageIndexes.includes(index)) this.failedImageIndexes = [...this.failedImageIndexes, index];
    },
    confirm(this: GahkchaModal) {
      if (isExactImageSelection(this.challenge.images, this.selectedIndexes)) {
        this.succeeded = true;
        this.feedback = this.challenge.successMessage;
        closeTimer = window.setTimeout(() => closeModal(true), SUCCESS_CLOSE_DELAY_MS);
      } else {
        this.feedback = "Ikke helt. Prøv igen.";
      }
    },
    skip() {
      closeModal(true);
    },
  }));

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const marked = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-gahkcha]") : null;
    if (!marked || !isEligibleElement(marked) || replayBypass.isActive(marked)) return;

    if (!shouldTrigger(sessionState, Date.now())) {
      persistSessionState(sessionState);
      return;
    }
    persistSessionState(sessionState);
    event.preventDefault();
    event.stopImmediatePropagation();

    pendingElement = marked;
    restoreFocusTo = marked;
    modal!.selectedIndexes = [];
    modal!.failedImageIndexes = [];
    modal!.feedback = "";
    modal!.succeeded = false;
    modal!.open = true;
    window.setTimeout(focusDialog, 0);
  }, true);
}
