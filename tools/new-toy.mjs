#!/usr/bin/env node
// Scaffold a new static toy: apps/<name>/{index.html,project.json}
// and register `<name>:serve` / `<name>:build` scripts in package.json.
//
// Usage: pnpm new-toy <name> ["Display Name"]
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const name = process.argv[2];
const display = process.argv[3] || name;

if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error('Usage: pnpm new-toy <name> ["Display Name"]');
  console.error('  <name> must be lower-case letters, numbers and dashes (used as the URL path).');
  process.exit(1);
}

const dir = join(root, 'apps', name);
if (existsSync(dir)) {
  console.error(`✗ apps/${name} already exists.`);
  process.exit(1);
}

mkdirSync(dir, { recursive: true });

writeFileSync(join(dir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${display}</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; }
  </style>
</head>
<body>
  <h1>${display}</h1>
  <script>
    console.log('${display} loaded');
  </script>
</body>
</html>
`);

writeFileSync(join(dir, 'project.json'), JSON.stringify({
  name,
  $schema: '../../node_modules/nx/schemas/project-schema.json',
  projectType: 'application',
  sourceRoot: `apps/${name}`,
  tags: ['type:static'],
  targets: {
    serve: {
      executor: 'nx:run-commands',
      options: { command: `vite apps/${name} --open` },
    },
    build: {
      executor: 'nx:run-commands',
      outputs: [`{workspaceRoot}/dist/${name}`],
      options: {
        command: `rsync -a --exclude=project.json --exclude=.DS_Store apps/${name}/ dist/${name}/`,
      },
    },
  },
}, null, 2) + '\n');

// Register convenience scripts in package.json
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.scripts ??= {};
pkg.scripts[`${name}:serve`] = `nx serve ${name}`;
pkg.scripts[`${name}:build`] = `nx build ${name}`;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`✓ Created apps/${name}/`);
console.log(`✓ Added "${name}:serve" and "${name}:build" scripts`);
console.log('');
console.log('Next steps:');
console.log(`  • pnpm ${name}:serve            # dev server`);
console.log(`  • Add it to the toy list in apps/home/index.html ({ name: '${display}', href: '${name}/' })`);
