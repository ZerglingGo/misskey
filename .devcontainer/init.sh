#!/bin/bash

set -xe

sudo chown node node_modules
sudo chown node:node /home/node/.claude
sudo apt-get update
sudo apt-get -y install libgtk2.0-0 libgtk-3-0 libgbm-dev libnotify-dev libnss3 libxss1 libasound2 libxtst6 xauth xvfb
git config --global --add safe.directory /workspace
git submodule update --init
sudo env "PATH=$PATH" npm install -g "$(node -p "require('./package.json').packageManager.split('+')[0]")" --ignore-scripts=false
hash -r
rm -rf /home/node/.local/share/pnpm/.tools/pnpm
pnpm config set store-dir /home/node/.local/share/pnpm/store
pnpm install --frozen-lockfile
cp .devcontainer/devcontainer.yml .config/default.yml
pnpm build
pnpm migrate
pnpm --filter frontend exec playwright install --with-deps chromium
