// Photos chosen via the Unsplash API. Per the Unsplash API guidelines they are hotlinked
// from images.unsplash.com (downloads were tracked when chosen) and credited on the page.
const UTM = "utm_source=payperwatch&utm_medium=referral";

function photo(raw: string, author: string, profile: string, alt: string) {
  const src = (w: number) => `${raw}&w=${w}&q=80&auto=format&fit=crop`;
  return {
    src: src(1600),
    srcSet: [800, 1200, 1600, 2400].map((w) => `${src(w)} ${w}w`).join(", "),
    alt,
    author,
    authorUrl: `${profile}?${UTM}`,
    unsplashUrl: `https://unsplash.com/?${UTM}`,
  };
}

export const HERO_PHOTO = photo(
  "https://images.unsplash.com/photo-1760170437237-a3654545ab4c?ixid=M3w5NTY2MTF8MHwxfGFsbHx8fHx8fHx8fDE3OTI1ODAyMDh8&ixlib=rb-4.1.0",
  "Peter Herrmann",
  "https://unsplash.com/@tama66",
  "Empty vintage cinema hall facing a lit screen",
);

export const REELS_PHOTO = photo(
  "https://images.unsplash.com/photo-1542204165-65bf26472b9b?ixid=M3w5NTY2MTF8MHwxfGFsbHx8fHx8fHx8fDE3OTI1ODAyMDd8&ixlib=rb-4.1.0",
  "Denise Jans",
  "https://unsplash.com/@dmjdenise",
  "Film reels lying on a white table",
);

export type Photo = typeof HERO_PHOTO;
