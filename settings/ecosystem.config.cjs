module.exports = {
  apps: [
    {
      name: 'hexnome-backend',
      cwd: '/home/www/hexnome/backend',

      /*
       * The built server, run directly — **not** `pnpm run start`.
       *
       * pm2 forks a script with Node unless told otherwise, and `pnpm` on the server is a shell
       * wrapper, so Node tried to parse `basedir=$(dirname …)` as JavaScript and the process errored
       * on the spot with `SyntaxError: missing ) after argument list`.
       *
       * `interpreter: 'none'` would fix the crash and leave the real problem: pm2 would be
       * supervising a shell that spawns pnpm that spawns node. Restarts and stops act on the wrapper,
       * memory and CPU figures describe the wrapper, and a killed wrapper can leave the server
       * orphaned and still holding the port. Running the file itself gives pm2 the process it is
       * meant to be managing.
       *
       * The build still happens in 01-backend-start.sh, where pnpm belongs.
       */
      script: 'dist/main.js',

      /*
       * `cwd` is load-bearing, not tidiness: `dotenv` resolves `.env` against the working directory,
       * and PORT and DATABASE_URL both come from backend/.env. Started from anywhere else the server
       * finds no file, listens on 3000 instead of 22466, and nginx answers 502.
       */

      error_file: '/home/logs/hexnome/backend.pm2.error.log',
      // Stdout too, beside the errors rather than in pm2's default directory — the startup banner
      // says which port it actually bound, which is the first thing worth reading after a 502.
      out_file: '/home/logs/hexnome/backend.pm2.out.log'
    }
  ]
}
