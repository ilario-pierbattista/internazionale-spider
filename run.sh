#!/bin/bash

docker-compose run --rm node bash -c "npx ts-node src/index.ts"
rsync -av downloads/* $HOME/Dropbox/Internazionale
