import esbuild from 'esbuild';
import { builtinModules } from 'node:module';

const production = process.argv[2] === 'production';

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  minify: production,
  treeShaking: true,
  metafile: true,
  legalComments: 'none',
  outfile: 'main.js',
});

if (production) {
  const result = await context.rebuild();
  const unexpected = Object.values(result.metafile.outputs).flatMap((o) => o.imports)
    .filter((i) => i.external && i.path !== 'obsidian');
  if (unexpected.length) throw new Error('Unexpected desktop-only or unbundled runtime dependency: ' + unexpected.map((i) => i.path).join(', '));
  await context.dispose();
} else {
  await context.watch();
}
