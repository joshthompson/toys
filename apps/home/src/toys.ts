export type Toy = {
  name: string;
  /**
   * - relative path -> internal toy in this repo, e.g. "leek/" -> /toys/leek/
   * - full URL      -> externally hosted toy in another repo
   * - null          -> shows as a greyed-out "coming soon" icon
   *
   * Either way it opens in a window on the desktop.
   */
  href: string | null;
  /** Icon / window artwork, drawn in a coloured tile. Falls back to a generic icon when absent. */
  image?: string;
  /**
   * Transparent icon artwork, used instead of `image`. Sits straight on the
   * desktop — no tile, no crop — for things that are already icon-shaped.
   */
  icon?: string;
  /** Override the URL loaded inside the window (defaults to `href`). */
  iframe?: string;
};

// Add a toy by dropping a line in here.
export const toys: Toy[] = [
  {
    name: "Let's Battle!",
    href: 'https://joshthompson.github.io/lets-battle/',
    image: '/images/lets-battle.png',
  },
  {
    name: 'Weird Text',
    href: 'textog/',
    image: '/images/text.png',
  },
  {
    name: 'Letter',
    href: 'letter/',
    image: '/images/letter.png',
    iframe: '/letter/',
  },
  {
    name: 'Alisa The Freediver',
    href: 'https://joshthompson.github.io/freediver/',
    image: '/images/freediver.png',
  },
  {
    name: 'Scoop Bus Run Club',
    href: 'https://scoopbus.run/',
    image: '/images/scoopbus.png',
  },
  {
    name: 'Dino Game',
    href: 'https://joshthompson.github.io/dino-game/',
    image: '/images/dino-game.png',
  },
  {
    name: `Josh's CV.doc`,
    href: 'https://joshthompson.github.io/',
    icon: '/images/pdf.png',
  },
];

/** A toy's artwork, whichever kind it has. */
export const artwork = (toy: Toy) => toy.image ?? toy.icon;

/** True for toys hosted in another repo. They still open in a window, just from another origin. */
export const isExternal = (href: string) => /^https?:\/\//.test(href);

/**
 * Vite is built with `base: './'`, so local paths stay relative to the document and
 * resolve correctly both at '/' in dev and at '/toys/' on GitHub Pages.
 */
export const resolve = (url: string) => (isExternal(url) ? url : url.replace(/^\//, ''));

/**
 * Every toy is framed with this hash, so a toy can check
 * `location.hash === '#embedded'` and lay itself out for a small window
 * (hide its own chrome, shrink margins, skip the intro, …).
 */
export const EMBED_HASH = '#embedded';

/** The URL to load inside a window: resolved, then flagged as embedded. */
export const embedUrl = (url: string) => resolve(url).replace(/#.*$/, '') + EMBED_HASH;

export const colours = ['#ff4747', '#5066e0', '#5aa65e', '#feb03d', '#874a87'];
