#!/bin/sh
cd "$(dirname "$0")"
npm install || exit 1
npm start
