const path = require('path');
const { task, src, dest } = require('gulp');

// Copies node and credential icons into dist so n8n can render them. tsc only
// emits JS; the SVG icons referenced by `icon: 'file:anyapi.svg'` are copied here.
task('build:icons', copyIcons);

function copyIcons() {
  const nodeSource = path.resolve('nodes', '**', '*.{png,svg}');
  const nodeDestination = path.resolve('dist', 'nodes');
  src(nodeSource).pipe(dest(nodeDestination));

  const credSource = path.resolve('credentials', '**', '*.{png,svg}');
  const credDestination = path.resolve('dist', 'credentials');
  return src(credSource).pipe(dest(credDestination));
}
