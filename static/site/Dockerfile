FROM node:20-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ARG CI_FAST_BUILD=0
RUN if [ "$CI_FAST_BUILD" = "1" ]; then npm run build:ci; else npm run build; fi

FROM alpine:3.20
WORKDIR /srv/marketing
COPY --from=build /app/dist ./dist
CMD ["sh", "-lc", "ls -la /srv/marketing/dist && echo 'lbpr-site image contains built assets under /srv/marketing/dist'"]
