const { spawn } = require('child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const ps = spawn('npx', ['electron-vite', 'dev'], { env, stdio: 'inherit', shell: true });
ps.on('close', (code) => process.exit(code));
