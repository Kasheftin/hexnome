module.exports = {
  apps: [
    {
      name: 'hexnome-backend',
      cwd: '/home/www/hexnome/backend',
      // No `port` key here: pm2 has no such option and ignores it, which reads as though the port is
      // configured when it is not. The port comes from PORT in backend/.env, loaded by dotenv in
      // main.ts — the same file DATABASE_URL already comes from.
      script: 'pnpm',
      args: 'run start',
      error_file: '/home/logs/hexnome/backend.pm2.error.log'
    }
  ]
}

