/**
 * Every screensaver is a Solid component in this folder, listed once here.
 *
 * To add one: write `MyThing.tsx` exporting a component that fills its parent and
 * animates until it unmounts, then add a line to SCREENSAVERS. The settings
 * dropdown and the desktop both read this list, so nothing else needs touching.
 */
import type { Component } from 'solid-js';
import { FacesOfGuy } from './FacesOfGuy';
import { Pipes } from './Pipes';

export type Screensaver = {
  /** Stored in settings, so keep it stable once shipped. */
  id: string;
  /** As it appears in the dropdown. */
  name: string;
  component: Component;
};

/** The dropdown value meaning "leave the screen alone". Never the id of a real saver. */
export const NO_SCREENSAVER = 'none';

export const SCREENSAVERS: Screensaver[] = [
  { id: 'pipes', name: 'Pipes', component: Pipes },
  { id: 'faces-of-guy', name: 'Faces Of Guy', component: FacesOfGuy },
];

export const findScreensaver = (id: string) => SCREENSAVERS.find((s) => s.id === id);

/**
 * Any saver can also be watched on its own, away from the desktop, at
 * `/screensaver/<id>`. The app is one page served from the site root, so the path is
 * read here rather than routed: everything up to `/screensaver/` is wherever the site
 * happens to live, and the segment after it names the saver.
 *
 * index.html leans on the same prefix to fix up its relative asset paths, so keep the
 * two in step.
 */
export const SCREENSAVER_ROUTE = '/screensaver/';

/** The saver the current URL asks for, if it asks for one that exists. */
export const routedScreensaver = (pathname = location.pathname) => {
  const at = pathname.indexOf(SCREENSAVER_ROUTE);
  if (at < 0) return undefined;
  const id = pathname.slice(at + SCREENSAVER_ROUTE.length).replace(/\/.*$/, '');
  return findScreensaver(decodeURIComponent(id));
};
