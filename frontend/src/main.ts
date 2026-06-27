import "./styles.css";
import "htmx.org";
import Alpine from "alpinejs";

// Alpine for small client-only interactions; HTMX (imported above) auto-wires hx-* attributes.
(window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine;
Alpine.start();

// Island logic (e.g. the ølkælder basket totals) will live here.
