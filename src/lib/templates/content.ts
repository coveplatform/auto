// Data scraped from a business's current website.

export interface ImageAsset {
  index: number;
  src: string; // original URL
  file: string | null; // file name inside the preview's assets/ folder once copied
  alt: string;
  context?: string; // nearby text on the page, e.g. a category label
  width: number;
  height: number;
  page: string;
}

export interface LogoCandidate {
  index: number;
  src: string;
  file: string | null;
  how: string;
  width: number;
  height: number;
}

export interface Extraction {
  sourceUrl: string;
  pages: Array<{ url: string; title: string; text: string }>;
  jsonLd: unknown[];
  images: ImageAsset[];
  logos: LogoCandidate[];
  colorCandidates: Array<{ color: string; weight: number; where: string }>;
  themeColor: string | null;
  socialLinks: string[];
  emails: string[];
  phones: string[];
  homepageShot: string | null; // relative to data dir
}
