FROM node:16-alpine

COPY --from=jrottenberg/ffmpeg:4.1-scratch / /

RUN apk add sox
RUN addgroup root audio
RUN apk add pulseaudio
RUN apk add alsa-plugins-pulse

WORKDIR /runtime
COPY ./package.json ./
RUN npm install
COPY ./tsconfig.json ./
COPY src ./src
COPY demo ./demo
RUN sed '2a\isMac = true;' -i /runtime/node_modules/mic/lib/mic.js