#!/bin/sh

SCRIPT=$(readlink -f "$0")
SCRIPTPATH=$(dirname "$SCRIPT")

cd "$SCRIPTPATH/../backend"
pnpm run prisma:push
pnpm run prisma:generate
pnpm run build
cd "$SCRIPTPATH"

# Deleted and started, not restarted.
#
# pm2 reads the config file only to *create* an app it does not already know. For one it does, the
# stored definition wins and a changed `script`, `cwd` or `interpreter` is ignored — by `restart`,
# and equally by `reload`, `startOrRestart`, `startOrReload` and even `start`. Only delete drops the
# definition so the file is read afresh.
#
# It is easy to believe otherwise, because an app that has crashed hard enough falls out of pm2's
# list, and then `restart` does pick up the change — there is nothing left to preserve. So the old
# line worked whenever the server was already broken and quietly did nothing whenever it was healthy.
#
# `|| true` because delete fails when there is nothing to delete, which is every first deploy.
pm2 delete hexnome-backend 2>/dev/null || true
pm2 start ecosystem.config.cjs --only hexnome-backend

