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
draggable and resizable window (single tap on touch), and right-click is
Josh OS's, not the browser's:

- **on an icon** — Open, Open externally, Rename, Save to My Computer, Delete
- **on the desktop** — Arrange Icons, Desktop Settings, About Josh OS
- **on a picture in the image viewer** — Copy Picture, Save Picture to My
  Computer, Make Desktop Background
- **anywhere else** — the browser menu is suppressed, no menu shown

Files go both ways, though only one of them is a drag: drop a file in from the
Finder and it lands on the desktop, and **Save to My Computer** puts it back on
the real machine. Dragging an icon out of the browser needs the browser to own
the drag, and these icons are carried by hand — the two can't both have the
pointer.

Deleting a toy (or dragging it onto the bin) hides it from the desktop and the
Start menu and makes it unopenable. Open the bin to put it back, or empty that
level to lose it for the session. None of this persists — a reload restores
everything.

### The bin that eats bins

Delete the Recycle Bin itself and it isn't destroyed: a new **Recycle Bin Bin**
appears containing it, and every further delete adds another ` Bin`. Only the
outermost bin sits on the desktop; the rest nest inside it, each keeping its own
contents. A toy binned before three nestings is still sitting in the original
Recycle Bin three levels down, and its **Put back** still returns it to the
desktop.

That's modelled as a stack in [App.tsx](apps/home/src/os/App.tsx) — `bins[0]` is the
original Recycle Bin and deleting pushes a new empty level, so no level ever has
to be rewritten:

```ts
const deleteBin = () => setBins(bins.length, { toys: [] });
```

The source is in three folders, and the rule for which is which is short: `os/`
is the computer, `apps/` is what runs on it, and `shared/` is what neither of
them owns. Anything that fills a window is an app, whether it has a desktop icon
(the calculator, the bank) or only ever turns up when the computer needs to say
something (a notice, a page of text).

```
apps/home/
  index.html            → the Vite entry shell
  public/images/        → toy artwork, copied verbatim to dist/images/
  src/index.tsx         → boots the desktop, or a screensaver on its own page
  src/styles.css        → the whole look

  src/os/               → the computer itself
    toys.ts             → THE TOY LIST — add new toys here
    shell.ts            → shared constants + types (a leaf module, see below)
    App.tsx             → desktop, window + icon + bin + bank state
    ToyWindow.tsx       → a draggable, resizable window
    Taskbar.tsx         → Start menu, task buttons, clock
    DesktopIcon.tsx     → a draggable desktop icon
    ContextMenu.tsx     → the right-click menu
    MenuBar.tsx         → the menus an app asks for, drawn by the OS
    PowerScreen.tsx     → shutting down, and starting up again
    Screensaver.tsx     → the idle screen; screensavers/ holds the savers
    files.ts            → dropped files, and the IndexedDB they live in
    storage.ts          → the little that survives a reload
    osApi.ts            → the postMessage protocol a framed toy talks

  src/apps/             → one file per thing that fills a window
    MathsPane.tsx       → the calculator, which is wrong on purpose
    mathsWorking.ts     → …and how it shows its working, wrongly
    mathsRivalry.ts     → …and what the two of them say about each other
    BankPane.tsx        → your money, and where the calculator's fees go
    CameraPane.tsx      → the camera, at 200x150
    PicturePane.tsx, WritingPane.tsx, AudioPane.tsx, VideoPane.tsx
    BinPane.tsx, SettingsPane.tsx, AboutPane.tsx, NoticePane.tsx, TextPane.tsx

  src/shared/           → helpers on neither side of that fence
    longPress.ts        → a long press, which is this desktop's right click
    media.tsx           → the bits an audio and a video window both need
```

`shell.ts` imports nothing but types and exists to break a cycle: `App` imports
the panes, and the panes need shared constants. Importing those back from `App`
made a loop, and a pane reading one at module scope (`SettingsPane`'s swatch
list) hit the temporal dead zone and crashed the app at boot. Shared values go in
`shell.ts`, never in `App.tsx`.

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
[`apps/home/src/os/toys.ts`](apps/home/src/os/toys.ts):

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
add an entry to the list in [`apps/home/src/os/toys.ts`](apps/home/src/os/toys.ts)
with a full `https://…` URL as the `href`. They get a shortcut badge on their
icon but otherwise behave the same, framed in a window like any other toy.

That relies on the other origin allowing itself to be framed. If a toy ever
starts sending `X-Frame-Options` or a `frame-ancestors` CSP, its window will
come up blank — the **↗** button is the way out.

## Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds every toy
into `dist/` and publishes it to the `gh-pages` branch on every push to `main`.
Point GitHub Pages at the `gh-pages` branch (root) in the repo settings.
