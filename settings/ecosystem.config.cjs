module.exports = {
  apps: [
    {
      name: 'hexnome-backend',
      cwd: '/home/www/hexnome/backend',
      port: '22466',
      script: 'pnpm',
      args: 'run start',
      error_file: '/home/logs/hexnome/backend.pm2.error.log'
    }
  ]
}

