/** One image of a `ScreenshotLightbox`, with what its details panel says about it. */
export interface LightboxImage {
  src: string;
  /** What the image shows — its caption. */
  name: string;
  /** The image shows the page at the failure: a failed dot before its caption. */
  failed?: boolean;
  /** The step the page was captured at, as its title (`click getByRole('button')`). */
  step?: string | null;
  /** The error raised on this page, shown in full. */
  error?: string | null;
  /** Short facts about the image (`1280×720`, `4.20% of pixels changed`). */
  facts?: string[];
}

/** The test every image of a lightbox belongs to, named once in its details panel. */
export interface LightboxSubject {
  title?: string | null;
  /** The test's `file:line[:col]`, opened in the IDE from the panel. */
  location?: string | null;
  projectKey?: string | number | null;
  projectName?: string | null;
}
