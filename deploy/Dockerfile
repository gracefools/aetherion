# NOT VERIFIED: no Docker daemon was available where this project was built (see docs/deploy.md).
# The same steps were verified without Docker by scripts/verify-deploy.sh.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
# types/shims.d.ts stands in for packages that could not be installed in the build sandbox
RUN rm -f types/shims.d.ts && node scripts/build-client.mjs && node scripts/build-server.mjs

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 APP_ROOT=/app
COPY --from=build /app/dist ./dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/db ./db
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.mjs"]
