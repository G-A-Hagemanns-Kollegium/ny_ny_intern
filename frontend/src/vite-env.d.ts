/// <reference types="vite/client" />

// Alpine.js 3 ships no type declarations and there is no maintained @types package for v3.
// We only use it for `Alpine.start()`, so an ambient `any` module is sufficient.
declare module "alpinejs";
