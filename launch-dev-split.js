const { spawn } = require('child_process');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// 1. Start vite dev server
const vite = spawn('npx', ['vite', '--config', 'vite-dev.config.ts', '--port', '5175', '--strictPort'], {
  env,
  shell: true,
  stdio: 'inherit'
});

// Wait for vite to be ready, then start electron
let electron;
const startElectron = () => {
  const electronEnv = { ...env, ELECTRON_RENDERER_URL: 'http://localhost:5175' };
  const electronPath = path.join(__dirname, 'node_modules/.bin/electron.cmd');
  electron = spawn(electronPath, ['--disable-gpu', 'out/main/index.js'], {
    env: electronEnv,
    shell: true,
    stdio: 'inherit'
  });
  electron.on('close', (code) => {
    console.log('Electron exited with code', code);
    vite.kill();
    process.exit(code || 0);
  });
};

// Give vite a few seconds to start
setTimeout(startElectron, 3000);

vite.on('close', (code) => {
  console.log('Vite dev server exited with code', code);
  if (electron) electron.kill();
  process.exit(code || 0);
});

process.on('SIGINT', () => {
  vite.kill();
  if (electron) electron.kill();
});
