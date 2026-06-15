# Josh's Toys

An [Nx](https://nx.dev) monorepo of small web "toys". Each toy is an app under
[`apps/`](apps/). The `home` app is the landing page that links to all the others.

Deployed to **https://joshthompson.github.io/toys/** — each toy lives at a
sub-path, e.g. `/toys/leek/` and `/toys/textog/`.

## Layout

```
apps/
  home/      → the landing page,            builds to  dist/
  leek/      → a toy,                        builds to  dist/leek/
  textog/    → a toy,                        builds to  dist/textog/
```

A toy is just a folder with an `index.html` (plus any images / css / js it
needs) and a `project.json` describing how to serve and build it.

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
[`apps/home/index.html`](apps/home/index.html).

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
add an entry to the list in [`apps/home/index.html`](apps/home/index.html) with
a full `https://…` URL as the `href`.

## Deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds every toy
into `dist/` and publishes it to the `gh-pages` branch on every push to `main`.
Point GitHub Pages at the `gh-pages` branch (root) in the repo settings.
