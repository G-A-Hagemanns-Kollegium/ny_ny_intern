/** A deliberately local, demo-only GAHKCHA image challenge. */
export type GahkchaImage = {
  src: string;
  alt: string;
  correct: boolean;
};

export type GahkchaImageChallenge = {
  id: string;
  type: "image-grid";
  title: string;
  prompt: string;
  images: readonly GahkchaImage[];
  successMessage: string;
};
