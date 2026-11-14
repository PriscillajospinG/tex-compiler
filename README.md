# TeX Compiler

A friendly online LaTeX editor. Write or upload a LaTeX project, press **Compile**, and preview the PDF next to your code. When something goes wrong, you get the error in plain English, the file and line (click to jump there), and the full compiler log.

**Features**
- **Editor:** LaTeX syntax highlighting, line numbers, error lines marked in the margin, <kbd>Ctrl/⌘</kbd>+<kbd>/</kbd> to comment lines.
- **Projects:** multiple files with folders, upload files or whole folders (or drag and drop), images, `.bib` bibliographies (BibTeX and Biber).
- **PDF preview:** zoom, fit-to-width and a page counter, and **auto compile** that keeps your scroll position.
- **Checks before compiling:** a missing `.bib` file, missing images or `\input` files, and unknown citation keys.
- **Design:** works on phones (Files / Editor / Preview tabs), has light and dark themes, and is keyboard accessible.

---

## Run it locally

You need [Node.js](https://nodejs.org) 18 or newer. There are no npm dependencies.

```sh
npm start
```

Open <http://127.0.0.1:3000>. Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop.

If TeX is installed on your computer, the app uses it. Otherwise it uses an online compile service (see [How compiling works](#how-compiling-works)). To compile locally, install TeX:

- **macOS:** `brew install --cask mactex-no-gui`, or the smaller `brew install --cask basictex`
- **Debian/Ubuntu:** `sudo apt install texlive-latex-extra texlive-bibtex-extra texlive-publishers biber`
- **Windows:** [MiKTeX](https://miktex.org) or [TeX Live](https://tug.org/texlive/)

```sh
npm test   # unit tests
```

---

## Deploy

The recommended way to host the app is the included **Docker image**. It contains Node.js and TeX Live, so:
- every document is compiled on **your** server,
- users' files never go to a third party,
- the app doesn't depend on a free online service being up.

The image includes article/report/book, beamer, elsarticle and other publisher classes, TikZ/pgfplots, science packages, biblatex/Biber, XeLaTeX and LuaLaTeX. It's about 2 GB; the first build takes a few minutes.

**Resources:** give the app at least **1 GB RAM**. 2 GB is comfortable for larger documents and a few users at once.

### Docker (any machine)

```sh
docker build -t tex-compiler .
docker run -d --name tex-compiler -p 3000:3000 --restart unless-stopped tex-compiler
```

Check it: `curl http://localhost:3000/healthz` should return `{"ok":true,"backend":"local",…}`.

### Render

1. Push this repository to GitHub.
2. In Render: **New → Blueprint** and pick the repository. `render.yaml` sets everything up: Docker runtime, health check and limits.
3. Use at least the **Starter** plan. The free plan's 512 MB of memory isn't enough for TeX.

### Railway

1. **New Project → Deploy from GitHub repo**. Railway finds the `Dockerfile` automatically.
2. Under *Settings → Networking*, generate a domain. Set the health check path to `/healthz`.

### Fly.io

```sh
fly launch --no-deploy        # detects the Dockerfile; choose a region
fly scale memory 1024
fly deploy
```

In `fly.toml`, set `internal_port = 3000`, and optionally add a health check on `/healthz`.

### Your own server (VPS)

```sh
git clone <your repo> tex-compiler && cd tex-compiler
docker compose up -d --build
```

`docker-compose.yml` runs the container read-only, with memory and CPU limits, and only on `127.0.0.1:3000`. Put a reverse proxy in front for HTTPS. With [Caddy](https://caddyserver.com) that's a two-line `Caddyfile`:

```
latex.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

### Deployment checklist

- [ ] HTTPS is on. The platforms above do this for you; on a VPS use Caddy, nginx + certbot, etc.
- [ ] `TRUST_PROXY=1` is set when behind a proxy or load balancer (the Docker image sets it). It makes rate limiting see the real visitor IP and enables HSTS.
- [ ] `/healthz` is configured as the health check.
- [ ] At least 1 GB RAM.
- [ ] Optional: tune `COMPILE_RATE_LIMIT` and `MAX_CONCURRENT_COMPILES` for your traffic.

---

## How compiling works

The browser sends the project files to `POST /api/compile`. The server then uses one of two backends:

| Backend | When | Notes |
|---------|------|-------|
| **local** | TeX is installed (always in Docker) | Runs pdfLaTeX/XeLaTeX/LuaLaTeX in a fresh temporary folder, with shell escape disabled and file access limited to the project. It then runs BibTeX or Biber if needed, and reruns TeX so references resolve. |
| **remote** | No TeX installed (e.g. `npm start` on a laptop) | Sends the project to the free [LaTeX-on-HTTP](https://github.com/YtoTech/latex-on-http) service (`latex.ytotech.com`). If that fails, it falls back to [texlive.net](https://texlive.net) for projects with only text files and no sub-folders. **Files leave your machine.** |

The app only ever shows a PDF that really came back from TeX. If the compiler fails or can't be reached, you get an error saying so.

---

## Configuration

All settings are optional environment variables.

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` (`0.0.0.0` when `NODE_ENV=production`) | Interface to bind |
| `TEX_BACKEND` | `auto` (`local` in Docker) | `auto`, `local` or `remote` |
| `TEX_TIMEOUT_MS` | `90000` | Stop a compile after this long |
| `COMPILE_RATE_LIMIT` | `30` | Compiles per visitor per minute (`0` = unlimited) |
| `MAX_CONCURRENT_COMPILES` | `2` | Compiles running at the same time. Roughly one per CPU core |
| `MAX_QUEUED_COMPILES` | `8` | Extra compiles allowed to wait. Beyond that, visitors are asked to retry |
| `TRUST_PROXY` | off (`1` in Docker) | Trust `X-Forwarded-For` / `X-Forwarded-Proto` from your proxy |
| `TEX_REMOTE_URL` | `https://latex.ytotech.com/builds/sync` | Remote backend (LaTeX-on-HTTP API) |
| `TEX_FALLBACK_URL` | `https://texlive.net/cgi-bin/latexcgi` | Backup remote backend. Set it empty to disable |

Limits: 300 files and 25 MB per project, 10 MB per file.

---

## Security

- **TeX sandboxing:** shell escape is off (`-no-shell-escape`), TeX can only read and write inside its own temporary folder (`openin_any=p`, `openout_any=p`), and every compile has a time limit.
- **Docker container:** runs as an unprivileged user. `docker-compose.yml` also makes the filesystem read-only and caps memory and CPU.
- **Abuse limits:** per-visitor rate limiting and a cap on simultaneous compiles.
- **HTTP headers:** Content-Security-Policy, X-Frame-Options, nosniff, Referrer-Policy, and HSTS over HTTPS.
- **User data:** projects are stored only in each visitor's browser (IndexedDB). The server keeps nothing after a compile.

---

## Project layout

```
server.js              HTTP server: static files, /api/compile, /healthz, security headers
lib/compile.js         Local and remote compiler backends
lib/limits.js          Rate limiter and compile queue
lib/project.js         Validates uploaded projects (paths, sizes, main file)
lib/parse-log.js       Turns TeX/BibTeX/Biber logs into friendly errors
public/index.html      Page markup
public/styles.css      Design system (light and dark)
public/js/app.js       App logic: files, compile, preview, layout
public/js/editor.js    Code editor (textarea + highlighting layer)
public/js/highlight.js LaTeX / BibTeX syntax highlighter
public/js/pdfview.js   PDF preview built on PDF.js
public/js/project.js   File helpers, starter example, pre-compile checks
public/js/store.js     Saves the project in the browser
public/vendor/pdfjs/   PDF.js 3.11.174 (Apache-2.0)
Dockerfile             Production image with TeX Live
docker-compose.yml     Hardened setup for your own server
render.yaml            One-click Render deployment
test/                  Unit tests (npm test)
```
