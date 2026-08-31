import type { GahkchaImageChallenge } from "./types";

// Replace these demo paths with real, local images in app/static/gahkcha/demo/.
// The content stays here so the modal/controller can support further challenge types later.
export const DEMO_HAGEMANN_CHALLENGE: GahkchaImageChallenge = {
  id: "demo-hagemann-001",
  type: "image-grid",
  title: "Bekræft at du er kollegian",
  prompt: "Vælg alle billeder med G. A. Hagemann",
  successMessage: "Mistænkeligt menneskelig adfærd registreret",
  images: [
    { src: "/static/gahkcha/demo/gahkcha-tile-01.jpg", alt: "Historisk portræt", correct: false },
    { src: "/static/gahkcha/demo/gahkcha-tile-02.jpg", alt: "Historisk portræt", correct: true },
    { src: "/static/gahkcha/demo/gahkcha-tile-03.jpg", alt: "Sort-hvidt fotografi", correct: false },
    { src: "/static/gahkcha/demo/gahkcha-tile-04.jpg", alt: "Sort-hvidt fotografi", correct: true },
    { src: "/static/gahkcha/demo/gahkcha-tile-05.jpg", alt: "Arkivfotografi", correct: false },
    { src: "/static/gahkcha/demo/gahkcha-tile-06.jpg", alt: "Arkivfotografi", correct: true },
    { src: "/static/gahkcha/demo/gahkcha-tile-07.jpg", alt: "Portræt i ramme", correct: false },
    { src: "/static/gahkcha/demo/gahkcha-tile-08.jpg", alt: "Historisk portræt", correct: false },
    { src: "/static/gahkcha/demo/gahkcha-tile-09.jpg", alt: "Portræt i ramme", correct: true },
    { src: "/static/gahkcha/demo/gahkcha-tile-10.jpg", alt: "Arkivfotografi", correct: false },
    { src: "/static/gahkcha/demo/gahkcha-tile-11.jpg", alt: "Historisk portræt", correct: true },
    { src: "/static/gahkcha/demo/gahkcha-tile-12.jpg", alt: "Sort-hvidt fotografi", correct: false },
    { src: "/static/gahkcha/demo/gahkcha-tile-13.jpg", alt: "Portræt i ramme", correct: true },
    { src: "/static/gahkcha/demo/gahkcha-tile-14.jpg", alt: "Historisk portræt", correct: false },
    { src: "/static/gahkcha/demo/gahkcha-tile-15.jpg", alt: "Arkivfotografi", correct: false },
    { src: "/static/gahkcha/demo/gahkcha-tile-16.jpg", alt: "Sort-hvidt fotografi", correct: false },
  ],
};
