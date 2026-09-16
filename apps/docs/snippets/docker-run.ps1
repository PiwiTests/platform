docker pull phenx/piwitests-server:latest
docker run -p 3000:3000 -v ${PWD}/.data:/app/.data phenx/piwitests-server:latest
