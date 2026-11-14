# TeX Compiler — production image
# Node.js + a TeX Live install, so documents are compiled on this server
# (no third-party compile service, and users' files never leave it).

FROM node:22-bookworm-slim

# TeX Live from Debian. This covers article/report/book, beamer, elsarticle and most
# publisher classes, biblatex + biber, XeLaTeX and LuaLaTeX, TikZ/pgfplots and common
# science packages. Add more packages here if your users need them.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      texlive-latex-base \
      texlive-latex-recommended \
      texlive-latex-extra \
      texlive-fonts-recommended \
      texlive-bibtex-extra \
      texlive-science \
      texlive-publishers \
      texlive-pictures \
      texlive-plain-generic \
      texlive-xetex \
      texlive-luatex \
      lmodern \
      cm-super \
      biber \
      fonts-dejavu-core \
      ca-certificates \
      tini \
 && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* \
 # Build the LuaTeX font cache once at image build time instead of on the first request.
 && (luaotfload-tool --update >/dev/null 2>&1 || true)

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TEX_BACKEND=local \
    TEX_FALLBACK_URL= \
    TRUST_PROXY=1

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public

# Run as an unprivileged user; TeX only gets a temporary folder per compile.
RUN useradd --create-home --uid 10001 texc \
 && mkdir -p /home/texc/.texlive /tmp \
 && chown -R texc:texc /home/texc
USER texc
ENV HOME=/home/texc TEXMFVAR=/home/texc/.texlive

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini forwards SIGTERM so in-flight compiles finish cleanly on redeploys.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
