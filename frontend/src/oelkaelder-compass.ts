/**
 * Browser-only integration for Ølkælderkompasset. It deliberately sends no
 * location information anywhere: the backend supplies only the destination.
 */

const EARTH_RADIUS_METRES = 6_371_000;

interface Destination {
  name: string;
  latitude: number | null;
  longitude: number | null;
}

interface CompassOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

type OrientationEventConstructor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

interface Coordinates {
  latitude: number;
  longitude: number;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Normalize an angle into the half-open range 0–360°. */
export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

/** Initial geographic bearing from one coordinate to another, clockwise from true north. */
export function calculateBearing(from: Coordinates, to: Coordinates): number {
  const fromLatitude = degreesToRadians(from.latitude);
  const toLatitude = degreesToRadians(to.latitude);
  const deltaLongitude = degreesToRadians(to.longitude - from.longitude);
  const y = Math.sin(deltaLongitude) * Math.cos(toLatitude);
  const x =
    Math.cos(fromLatitude) * Math.sin(toLatitude) -
    Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(deltaLongitude);

  return normalizeAngle(radiansToDegrees(Math.atan2(y, x)));
}

/** Great-circle distance in metres (Haversine formula). */
export function calculateDistance(from: Coordinates, to: Coordinates): number {
  const deltaLatitude = degreesToRadians(to.latitude - from.latitude);
  const deltaLongitude = degreesToRadians(to.longitude - from.longitude);
  const fromLatitude = degreesToRadians(from.latitude);
  const toLatitude = degreesToRadians(to.latitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return EARTH_RADIUS_METRES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Direction to turn the arrow, clockwise from the top of the phone. */
export function calculateRelativeBearing(targetBearing: number, deviceHeading: number): number {
  return normalizeAngle(targetBearing - deviceHeading);
}

function validDestination(destination: Destination): destination is Destination & Required<Coordinates> {
  return (
    typeof destination.latitude === "number" &&
    Number.isFinite(destination.latitude) &&
    typeof destination.longitude === "number" &&
    Number.isFinite(destination.longitude)
  );
}

function closestEquivalentAngle(current: number, target: number): number {
  const difference = ((target - current + 540) % 360) - 180;
  return current + difference;
}

function screenAngle(): number {
  const typedScreen = screen as Screen & { orientation?: ScreenOrientation };
  if (typeof typedScreen.orientation?.angle === "number") {
    return typedScreen.orientation.angle;
  }
  const legacyWindow = window as Window & { orientation?: number };
  return typeof legacyWindow.orientation === "number" ? legacyWindow.orientation : 0;
}

class OelkaelderCompass {
  private readonly arrow: HTMLElement;
  private readonly visual: HTMLElement;
  private readonly distance: HTMLElement;
  private readonly bearing: HTMLElement;
  private readonly status: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private destination: Destination;
  private position: Coordinates | null = null;
  private heading: number | null = null;
  private rawAlpha: number | null = null;
  private watchId: number | null = null;
  private displayedRotation = 0;
  private orientationAttached = false;
  private locationError: string | null = null;
  private orientationError: string | null = null;

  constructor(private readonly root: HTMLElement, destination: Destination) {
    this.destination = destination;
    this.arrow = this.requireElement<HTMLElement>("[data-compass-arrow]");
    this.visual = this.requireElement<HTMLElement>("[data-compass-visual]");
    this.distance = this.requireElement<HTMLElement>("[data-compass-distance]");
    this.bearing = this.requireElement<HTMLElement>("[data-compass-bearing]");
    this.status = this.requireElement<HTMLElement>("[data-compass-status]");
    this.startButton = this.requireElement<HTMLButtonElement>("[data-compass-start]");
    this.startButton.addEventListener("click", () => void this.start());

    if (!validDestination(destination)) {
      this.destinationError();
      return;
    }
    this.startCountdowns();
  }

  private requireElement<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Ølkælderkompasset mangler ${selector}.`);
    }
    return element;
  }

  private destinationError(): void {
    this.status.textContent = "Kompasset venter på Ølkælderens koordinater i serverens indstillinger.";
    this.distance.textContent = "Destination ikke konfigureret";
    this.visual.setAttribute("aria-label", "Ølkælderens destination er ikke konfigureret");
    this.startButton.hidden = true;
  }

  private async start(): Promise<void> {
    if (!validDestination(this.destination)) {
      return;
    }
    this.startButton.disabled = true;
    this.startButton.textContent = "Starter…";
    this.locationError = null;
    this.orientationError = null;

    // iOS requires this call to happen as part of the tap that started the compass.
    await this.enableOrientation();
    this.startLocationTracking();
    this.updateInterface();
  }

  private async enableOrientation(): Promise<void> {
    if (!("DeviceOrientationEvent" in window)) {
      this.orientationError = "Kompasretning er ikke tilgængelig i denne browser.";
      return;
    }

    const orientationConstructor = window.DeviceOrientationEvent as OrientationEventConstructor;
    if (orientationConstructor.requestPermission) {
      try {
        const permission = await orientationConstructor.requestPermission();
        if (permission !== "granted") {
          this.orientationError = "Kompasadgang blev ikke tilladt. Du kan stadig se afstanden.";
          return;
        }
      } catch {
        this.orientationError = "Kompasadgang blev ikke tilladt. Du kan stadig se afstanden.";
        return;
      }
    }

    if (!this.orientationAttached) {
      window.addEventListener("deviceorientation", this.onOrientation, true);
      window.addEventListener("orientationchange", this.onScreenOrientationChange);
      const typedScreen = screen as Screen & { orientation?: ScreenOrientation };
      typedScreen.orientation?.addEventListener("change", this.onScreenOrientationChange);
      this.orientationAttached = true;
    }
  }

  private startLocationTracking(): void {
    if (!("geolocation" in navigator)) {
      this.locationError = "Din browser understøtter ikke positionsadgang.";
      return;
    }
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        this.position = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        this.locationError = null;
        this.updateInterface();
      },
      (error) => {
        this.locationError =
          error.code === error.PERMISSION_DENIED
            ? "Kompasset skal have adgang til telefonens position for at finde vej."
            : "Vi kan ikke hente din position lige nu. Prøv igen udenfor eller med bedre signal.";
        this.updateInterface();
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
  }

  private onOrientation = (event: DeviceOrientationEvent): void => {
    const compassEvent = event as CompassOrientationEvent;
    const appleHeading = compassEvent.webkitCompassHeading;
    if (typeof appleHeading === "number" && Number.isFinite(appleHeading)) {
      this.heading = normalizeAngle(appleHeading);
    } else if (typeof event.alpha === "number" && Number.isFinite(event.alpha)) {
      this.rawAlpha = event.alpha;
      this.heading = normalizeAngle(360 - event.alpha + screenAngle());
    } else {
      return;
    }
    this.orientationError = null;
    this.updateInterface();
  };

  private onScreenOrientationChange = (): void => {
    if (this.rawAlpha !== null) {
      this.heading = normalizeAngle(360 - this.rawAlpha + screenAngle());
      this.updateInterface();
    }
  };

  private updateInterface(): void {
    if (!validDestination(this.destination)) {
      return;
    }
    if (this.locationError) {
      this.status.textContent = this.locationError;
      this.visual.setAttribute("aria-label", "Kompasretning er ikke tilgængelig uden position");
      this.startButton.hidden = false;
      this.startButton.disabled = false;
      this.startButton.textContent = "Prøv igen";
      return;
    }
    if (!this.position) {
      this.status.textContent = "Finder din position…";
      this.visual.setAttribute("aria-label", "Finder telefonens position");
      return;
    }

    const target = { latitude: this.destination.latitude, longitude: this.destination.longitude };
    const metres = calculateDistance(this.position, target);
    const targetBearing = calculateBearing(this.position, target);
    this.distance.textContent = `${Math.round(metres)} m væk`;
    this.bearing.textContent = `Ølkælderen ligger ${Math.round(targetBearing)}° fra nord.`;
    this.bearing.hidden = false;

    if (this.orientationError || this.heading === null) {
      this.status.textContent =
        this.orientationError ?? "Venter på telefonens kompasretning — du kan stadig se afstanden.";
      this.visual.setAttribute("aria-label", `${this.distance.textContent}. Retningskompas ikke tilgængeligt.`);
      this.startButton.hidden = this.orientationAttached;
      this.startButton.disabled = false;
      if (!this.orientationAttached) this.startButton.textContent = "Prøv igen";
      return;
    }

    const relativeBearing = calculateRelativeBearing(targetBearing, this.heading);
    this.displayedRotation = closestEquivalentAngle(this.displayedRotation, relativeBearing);
    this.arrow.style.transform = `translateX(-50%) rotate(${this.displayedRotation}deg)`;
    this.status.textContent = "Peg telefonen mod pilens retning.";
    this.visual.setAttribute(
      "aria-label",
      `${this.distance.textContent}. Drej ${Math.round(relativeBearing)} grader med uret for at gå mod Ølkælderen.`,
    );
    this.startButton.hidden = true;
  }

  private startCountdowns(): void {
    const offers = Array.from(this.root.querySelectorAll<HTMLElement>("[data-offer-expires-at]"));
    if (!offers.length) return;
    const emptyStates = Array.from(this.root.querySelectorAll<HTMLElement>("[data-compass-offer-empty]"));
    const update = (): void => {
      let visibleOffers = 0;
      for (const offer of offers) {
        const expiresAt = Date.parse(offer.dataset.offerExpiresAt ?? "");
        const remaining = expiresAt - Date.now();
        if (!Number.isFinite(expiresAt) || remaining <= 0) {
          offer.hidden = true;
          continue;
        }
        visibleOffers += 1;
        const countdown = offer.querySelector<HTMLElement>("[data-offer-countdown]");
        if (countdown) {
          const minutes = Math.ceil(remaining / 60_000);
          countdown.textContent = minutes <= 1 ? "Under et minut tilbage" : `${minutes} min tilbage`;
        }
      }
      for (const empty of emptyStates) empty.hidden = visibleOffers > 0;
    };
    update();
    window.setInterval(update, 30_000);
  }
}

function mountCompass(root: HTMLElement): void {
  const scriptId = root.dataset.destinationScript;
  const script = scriptId ? document.getElementById(scriptId) : null;
  if (!(script instanceof HTMLScriptElement)) return;
  try {
    const destination = JSON.parse(script.textContent ?? "{}") as Destination;
    new OelkaelderCompass(root, destination);
  } catch {
    root.querySelector<HTMLElement>("[data-compass-status]")!.textContent =
      "Kompasset kunne ikke indlæse destinationen.";
  }
}

document.querySelectorAll<HTMLElement>("[data-oelkaelder-compass]").forEach(mountCompass);
