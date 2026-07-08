import "./styles.css";
import "htmx.org";
import Alpine from "alpinejs";
import "./charts"; // interactive charts on /nyintern/statistik/ (no-op elsewhere)
import "./imageupload"; // downscale room-inspection photo uploads client-side (no-op elsewhere)

// Alpine for small client-only interactions; HTMX (imported above) auto-wires hx-* attributes.
(window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine;
Alpine.start();

// Island logic (e.g. the ølkælder basket totals) will live here.
