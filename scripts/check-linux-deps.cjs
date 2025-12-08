#!/usr/bin/env node

const { spawnSync } = require('child_process');

// Only enforce this on Linux; other platforms use different system deps.
if (process.platform !== 'linux') {
  process.exit(0);
}

function hasCommand(cmd) {
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return result.status === 0;
}

if (!hasCommand('pkg-config')) {
  console.error('\n[yaak] Missing required tool: pkg-config');
  console.error('Install it via your system package manager (for example on Debian/Ubuntu/Pop!_OS: `sudo apt install pkg-config`).\n');
  process.exit(1);
}

const libs = ['pango', 'gdk-pixbuf-2.0', 'gdk-3.0', 'atk', 'webkit2gtk-4.1'];

const check = spawnSync('pkg-config', ['--exists', ...libs], { stdio: 'ignore' });

if (check.status !== 0) {
  console.error('\n[yaak] Missing one or more system libraries required to build the Tauri app on Linux.');
  console.error('Required pkg-config packages: ' + libs.join(', '));
  console.error('\nOn Debian/Ubuntu/Pop!_OS you can install them with:');
  console.error('  sudo apt update');
  console.error('  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev');
  console.error('\nAfter installing these, re-run `npm start`.\n');
  process.exit(1);
}

process.exit(0);
