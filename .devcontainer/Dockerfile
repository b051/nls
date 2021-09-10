FROM b051/typescript:16-alpine

RUN apk add sox
RUN addgroup root audio
RUN apk add pulseaudio
RUN apk add alsa-plugins-pulse

WORKDIR /runtime

COPY ./package.json ./.npmrc ./
RUN npm install
RUN sed '2a\isMac = true;' -i /runtime/node_modules/mic/lib/mic.js