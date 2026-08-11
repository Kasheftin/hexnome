#!/bin/sh

SCRIPT=$(readlink -f "$0")
SCRIPTPATH=$(dirname "$SCRIPT")

cd "$SCRIPTPATH/../backend"
pnpm run prisma:push
pnpm run prisma:generate
pnpm run build
cd "$SCRIPTPATH"
pm2 restart ecosystem.config.cjs --only hexnome-backend

