# Josh's Toys

An [Nx](https://nx.dev) monorepo of small web "toys". Each toy is an app under
[`apps/`](apps/). The `home` app is the landing page that links to all the others.

Deployed to **https://joshthompson.github.io/toys/** — each toy lives at a
sub-path, e.g. `/toys/leek/` and `/toys/textog/`.

## Layout

```
apps/
  home/      → the landing page (Solid),     builds to  dist/
  leek/      → a toy,                        builds to  dist/leek/
  textog/    → a toy,                        builds to  dist/textog/
```

A toy is just a folder with an `index.html` (plus any images / css / js it
needs) and a `project.json` describing how to serve and build it.

The `home` app is the exception: it's a [Solid](https://solidjs.com) + Vite app
that renders a little desktop. Icons drag anywhere, double-click to open a
draggable and resizable window (single tap on touch), and there's a Recycle Bin
you can drag toys onto — binned toys vanish from the desktop and the Start menu
and can't be opened. Open the bin to put them back, or empty it to lose them for
the session. None of that persists: a reload puts everything back.

```
apps/home/
  index.html          → the Vite entry shell
  public/images/      → toy artwork, copied verbatim to dist/images/
  src/toys.ts         → THE TOY LIST — add new toys here
  src/App.tsx         → desktop, window + icon + bin state
  src/ToyWindow.tsx   → a draggable, resizable window
  src/Taskbar.tsx     → Start menu, task buttons, clock
  src/DesktopIcon.tsx → a draggable desktop icon
  src/BinPane.tsx     → what's inside the Recycle Bin window
  src/styles.css      → the whole look
```

It's built with `base: './'` so the exact same output works at `/` locally and
at `/toys/` on GitHub Pages. `pnpm home:build` typechecks first, bundles into a
staging dir, then syncs into `dist/` — it never empties `dist/`, so it can't
clobber the other toys' output.

## The `#embedded` hash

Every toy is framed as `<toy-url>#embedded`. A toy can check for that hash and
lay itself out for a small window — hide its own header, shrink margins, skip
the intro, whatever suits it:

```html
<!-- in <head>, before any CSS, so the windowed layout doesn't flash -->
<script>
  if (location.hash === '#embedded') document.documentElement.classList.add('embedded');
</script>
<style>
  header { display: block; }
  .embedded header { display: none; }
</style>
```

`pnpm new-toy` scaffolds this hook for you. Toys that ignore the hash still work
fine — they just render their full-page layout in the window. Every window also
has an **↗** button to open the toy full-page in a new tab.

## Commands

```bash
pnpm install            # one-time setup

pnpm serve              # run the landing page
pnpm leek:serve         # run a single toy (opens the browser, hot reload)
pnpm leek:build         # build a single toy into dist/leek/

pnpm build              # build every toy into dist/
pnpm preview            # build everything, then serve dist/ as the full site (snapshot)
pnpm preview:watch      # same as preview, but rebuilds dist/ on source change + reloads
```

`preview` is a one-shot snapshot of exactly what deploys. `preview:watch` keeps
the full site (all toys at their real sub-paths) live: it watches every app,
rebuilds the changed toy into `dist/`, and Vite reloads the browser — including
for vanilla toys, since it serves `dist/` through the Vite dev server.

Under the hood `pnpm leek:serve` is just `nx serve leek`, so you can also use
the Nx CLI directly: `pnpm nx serve leek`, `pnpm nx run-many -t build`, etc.

## Adding a toy

```bash
pnpm new-toy spirograph "Spirograph"
```

This scaffolds `apps/spirograph/`, registers `spirograph:serve` /
`spirograph:build`, then add it to the list in
[`apps/home/src/toys.ts`](apps/home/src/toys.ts):

```ts
{ name: 'Spirograph', href: 'spirograph/', image: '/images/spirograph.png' }
```

Drop the artwork in [`apps/home/public/images/`](apps/home/public/images/).
`href: null` renders a greyed-out "coming soon" icon.

### Two kinds of toy

- **Static** (the default): a flat `index.html` with maybe some images / css /
  js. The build just **copies** the folder to `dist/<name>/` — no bundling.
- **Framework** (Vite + a JS framework): give the toy its own `package.json`
  and `vite.config.*`, and change its `build` target to bundle with the correct
  base path so assets resolve under `/toys/<name>/`:

  ```jsonc
  "build": {
    "executor": "nx:run-commands",
    "outputs": ["{workspaceRoot}/dist/<name>"],
    "options": {
      "command": "vite build apps/<name> --base=/toys/<name>/ --outDir ../../dist/<name> --emptyOutDir"
    }
  }
  ```

### Externally-hosted toys

Some toys live in their own repos. Don't add an `apps/` folder for those — just
add an entry to the list in [`apps/home/src/toys.ts`](apps/home/src/toys.ts)
with a full `https://…` URL as the `href`. They get a shortcut badge on their
icon but otherwise behave the same, framed in a window like any other toy.

That relies on the other origin allowing itself to be framed. If a toy ever
starts sending `X-Frame-Options` or a `frame-ancestors` CSP, its window will
come up blank — the **↗** button is the way out.

## Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds every toy
into `dist/` and publishes it to the `gh-pages` branch on every push to `main`.
Point GitHub Pages at the `gh-pages` branch (root) in the repo settings.
