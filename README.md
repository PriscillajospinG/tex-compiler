# TeX Compiler

A friendly web app for writing LaTeX and turning it into a PDF. Write or upload your LaTeX project, press **Compile**, and see the PDF right next to your code. If something is wrong, it tells you what happened in plain English and takes you to the right line.

You can run it on your own computer in a few minutes, or host it as a website for others.

**Features**
- **Editor:** LaTeX syntax highlighting, line numbers, and errors marked in the margin.
- **Projects:** multiple files and folders. Upload files or whole folders, or drag them in. Images and `.bib` bibliographies (BibTeX and Biber) work.
- **PDF preview:** zoom, fit-to-width, and a page counter. **Auto compile** updates the PDF as you type and keeps your place.
- **Clear errors:** file and line, a short explanation, and the full log if you want it.
- **Checks before compiling:** missing `.bib` files, missing images, and citation keys that don't exist.
- **Works everywhere:** desktop and phone, light and dark mode, keyboard accessible.

---

## Contents

1. [Quick start](#1-quick-start)
   - [Option A: Docker (recommended)](#option-a-docker-recommended)
   - [Option B: Node.js only](#option-b-nodejs-only)
2. [Using the app](#2-using-the-app)
3. [Host it as a website](#3-host-it-as-a-website)
4. [Configuration](#4-configuration)
5. [Troubleshooting](#5-troubleshooting)
6. [How it works](#6-how-it-works)
7. [For developers](#7-for-developers)

---

## 1. Quick start

First, get the code:

```sh
git clone https://github.com/PriscillajospinG/tex-compiler.git
cd tex-compiler
```

No Git? On the GitHub page click **Code → Download ZIP**, unzip it, and open a terminal in that folder.

Then pick **one** of the two options below.

| | Option A: Docker | Option B: Node.js |
|---|---|---|
| You install | Docker | Node.js (+ TeX for offline use) |
| TeX included | ✅ Yes, everything | ❌ No. Install it yourself, or it uses an online service |
| Your files stay on your computer | ✅ Always | Only if TeX is installed |
| Download size | ~1.2 GB (once) | Tiny |
| Best for | Everyday use, hosting | Trying it quickly, development |

### Option A: Docker (recommended)

Everything you need, including TeX Live, comes in one package.

1. Install **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (Windows, macOS) or **[Docker Engine](https://docs.docker.com/engine/install/)** (Linux), and start it.
2. In the `tex-compiler` folder, run:

   ```sh
   docker compose up -d --build
   ```

   The first time takes 5–10 minutes while it downloads TeX. After that it starts in seconds.
3. Open **<http://localhost:3000>**.

To stop it, run `docker compose down`. To start it again, run `docker compose up -d`.

<details>
<summary>Without Docker Compose</summary>

```sh
docker build -t tex-compiler .
docker run -d --name tex-compiler -p 3000:3000 --restart unless-stopped tex-compiler
```

Stop it with `docker stop tex-compiler`, and start it again with `docker start tex-compiler`.
</details>

### Option B: Node.js only

1. Install **[Node.js](https://nodejs.org) 18 or newer** (the LTS version is fine). Check it with `node -v`.
2. In the `tex-compiler` folder, run:

   ```sh
   npm start
   ```

   There's no `npm install` step; the app has no dependencies.
3. Open **<http://localhost:3000>**. Stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd>.

**About TeX:** if TeX isn't installed, the app sends your files to a free online compile service. That needs internet access, isn't private, and the service is sometimes down. To compile on your own computer, install TeX and restart the app:

| System | Command / download |
|---|---|
| macOS | `brew install --cask mactex-no-gui` (full), or `brew install --cask basictex` (small) |
| Ubuntu / Debian | `sudo apt install texlive-latex-extra texlive-bibtex-extra texlive-publishers biber` |
| Fedora | `sudo dnf install texlive-scheme-medium biber` |
| Windows | [MiKTeX](https://miktex.org/download) or [TeX Live](https://tug.org/texlive/windows.html) |

When TeX is found, the terminal shows `Compiler: local TeX installation`.

---

## 2. Using the app

| To… | Do this |
|---|---|
| Write | Type in the editor. The example document is ready to compile. |
| Compile | Click **Compile** or press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd>. Turn on **Auto compile** to update the PDF as you type. |
| Add files | **New file**, **Upload files**, or **Upload folder** in the left menu, or drag files or folders onto the file list. |
| Use an image | Upload it, click it in the file list, and copy the `\includegraphics{…}` line shown. |
| Use a bibliography | Upload your `.bib` file next to your main `.tex` file, then use `\bibliography{name}` or `\addbibresource{name.bib}`. |
| Choose the main file | The file marked **MAIN** is compiled. Open another `.tex` file and click **Set as main** to change it. |
| Fix an error | Click the blue `file.tex:12` link under an error to jump to that line. |
| Download | Click **Download PDF**. |
| Start over | **Reset to example** (this replaces your files). |

**Keyboard shortcuts:** <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> compiles, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>/</kbd> comments lines in or out, and <kbd>Tab</kbd> moves to the next button.

**Where is my work saved?** Automatically, **in your browser** on this device. It stays when you close the tab, but not if you clear browser data or switch browser or computer. The server never keeps your files. Download your PDF and keep copies of important `.tex` files.

---

## 3. Host it as a website

Use the Docker image. It includes TeX, so documents are compiled on your own server: private, fast, and no dependence on outside services.

**What you need:** a host that runs Docker, with **at least 1 GB RAM**. Free plans with 512 MB are too small for TeX.

### Render (easiest)

1. Fork or push this repository to your GitHub account.
2. On [render.com](https://render.com): **New → Blueprint**, then pick the repository. `render.yaml` configures everything.
3. Choose **Starter** or a larger plan and click **Apply**. The first deploy takes 5–10 minutes.
4. Open the URL Render gives you and press **Compile**. The footer under the PDF should say **local TeX**.

Every `git push` to GitHub redeploys automatically.

### Railway

1. On [railway.app](https://railway.app): **New Project → Deploy from GitHub repo**. The `Dockerfile` is detected automatically.
2. In **Settings → Networking**, click **Generate Domain**. Set the health check path to `/healthz`.

### Fly.io

```sh
fly launch --no-deploy     # detects the Dockerfile; answer the prompts
fly scale memory 1024
fly deploy
```

Make sure `internal_port = 3000` in the generated `fly.toml`.

### Your own server (VPS)

On any Linux server with Docker:

```sh
git clone https://github.com/PriscillajospinG/tex-compiler.git
cd tex-compiler
docker compose up -d --build
```

The app now listens on `127.0.0.1:3000`. Put a web server in front of it for HTTPS. With [Caddy](https://caddyserver.com), the whole `Caddyfile` is:

```
latex.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

To update later: `git pull && docker compose up -d --build`.

### After hosting

- **Is it healthy?** Open `https://your-site/healthz`. You should see `{"ok":true,"backend":"local",…}`.
- **Logs:** each compile prints one line, for example `[compile] ok pdflatex 0.3s 2 files 1KB via local`.
- **Custom domain:** add it in your host's settings; HTTPS is automatic on Render, Railway and Fly.
- **Missing LaTeX package?** Add the Debian package (for example `texlive-lang-german`) to the `apt-get install` list in the `Dockerfile`, then push or rebuild.

---

## 4. Configuration

Everything works without configuration. To change a setting, set an environment variable: in your host's dashboard, in `docker-compose.yml` under `environment:`, or on the command line (e.g. `PORT=8080 npm start`).

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port the app listens on |
| `HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Network interface. Use `0.0.0.0` to allow other devices |
| `TEX_BACKEND` | `auto` (`local` in Docker) | `auto` = use TeX if installed, otherwise the online service. `local` or `remote` forces one |
| `TEX_TIMEOUT_MS` | `90000` | Stop a compile after this many milliseconds |
| `COMPILE_RATE_LIMIT` | `30` | Compiles allowed per visitor per minute (`0` = no limit) |
| `MAX_CONCURRENT_COMPILES` | `2` | Compiles running at the same time (about one per CPU core) |
| `MAX_QUEUED_COMPILES` | `8` | How many more may wait. Beyond that, visitors are asked to retry |
| `TRUST_PROXY` | off (`1` in Docker) | Set to `1` behind a proxy or load balancer so limits see real visitor IPs |
| `TEX_REMOTE_URL` | `https://latex.ytotech.com/builds/sync` | Online compile service (remote mode only) |
| `TEX_FALLBACK_URL` | `https://texlive.net/cgi-bin/latexcgi` | Backup online service. Set it empty to disable |

**Limits:** 300 files and 25 MB per project, 10 MB per file.

---

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| `port is already allocated` / `EADDRINUSE` | Something else uses port 3000. Use another port: `PORT=8080 npm start`, or change `"127.0.0.1:3000:3000"` to `"127.0.0.1:8080:3000"` in `docker-compose.yml` and open <http://localhost:8080>. |
| `Cannot connect to the Docker daemon` | Docker Desktop isn't running. Start it and wait until it says it's running. |
| `node: command not found`, or errors about `fetch` | Install Node.js 18 or newer. |
| "Could not reach latex.ytotech.com" / "internal error (HTTP 500)" | The free online service is down. Install TeX (see [Option B](#option-b-nodejs-only)) or use Docker. Both compile locally. |
| `File 'something.sty' not found` | A LaTeX package isn't installed. With Docker, add it to the `Dockerfile` and rebuild. With a local TeX, install it with your TeX package manager (`tlmgr install something`, or MiKTeX Console). |
| Citations show as **[?]** | Upload your `.bib` file and check that `\bibliography{name}` matches its file name. The yellow warning bar above the PDF tells you what's missing. |
| Image doesn't appear | Upload the image and use the same path in `\includegraphics{…}`, including folders (e.g. `figures/plot.png`). |
| Docker build fails or the container restarts | Give Docker at least 2 GB of memory (Docker Desktop → Settings → Resources). |
| My files disappeared | Projects are saved per browser. A different browser, private window or cleared site data starts fresh. |

Still stuck? [Open an issue](https://github.com/PriscillajospinG/tex-compiler/issues) with the error message.

---

## 6. How it works

```
 Browser                                   Server (Node.js)
 ─────────────────────────                 ─────────────────────────────────────
 Editor, files, preview      POST          /api/compile
 (saved in your browser)  ───────────▶     ├─ local:  TeX in a temporary folder → PDF
                          ◀───────────     └─ remote: online compile service  → PDF
                          PDF or errors    (temporary files are deleted afterwards)
```

- **Local compiling:** runs pdfLaTeX, XeLaTeX or LuaLaTeX, then BibTeX or Biber if your document has a bibliography, then reruns TeX so references and citations resolve.
- **Remote compiling:** sends the project to [LaTeX-on-HTTP](https://github.com/YtoTech/latex-on-http). If that fails, it tries [texlive.net](https://texlive.net) (text-only projects without folders).
- **Honest results:** the app only shows a PDF that TeX actually produced. If compiling fails, you see why.

**Security**
- **TeX sandbox:** shell commands are disabled (`-no-shell-escape`), TeX can only read and write inside its own temporary folder, and each compile has a time limit.
- **Docker:** runs as a non-root user. `docker-compose.yml` adds a read-only filesystem and memory and CPU limits.
- **Abuse limits:** per-visitor rate limiting and a cap on simultaneous compiles.
- **HTTP headers:** Content-Security-Policy, X-Frame-Options, nosniff and Referrer-Policy, plus HSTS over HTTPS.
- **No stored data:** nothing is kept on the server, and there are no accounts or tracking.

---

## 7. For developers

```sh
npm start      # run the app
npm test       # run the unit tests (Node's built-in test runner)
```

No build step and no dependencies: plain Node.js on the server, plain HTML/CSS/JavaScript modules in the browser.

```
server.js              HTTP server: static files, /api/compile, /healthz, security headers
lib/compile.js         Local and remote compiler backends
lib/limits.js          Rate limiter and compile queue
lib/project.js         Validates uploaded projects (paths, sizes, main file)
lib/parse-log.js       Turns TeX/BibTeX/Biber logs into friendly errors
public/index.html      Page markup
public/styles.css      Design (light and dark)
public/js/app.js       App logic: files, compiling, preview, layout
public/js/editor.js    Code editor (textarea + highlighting layer)
public/js/highlight.js LaTeX / BibTeX syntax highlighting
public/js/pdfview.js   PDF preview built on PDF.js
public/js/project.js   File helpers, starter example, pre-compile checks
public/js/store.js     Saves the project in the browser (IndexedDB)
public/vendor/pdfjs/   PDF.js 3.11.174 (Apache-2.0)
Dockerfile             Production image with TeX Live
docker-compose.yml     Ready-to-run setup with security limits
render.yaml            One-click Render deployment
test/                  Unit tests
```

### Credits

- [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla (Apache-2.0) for the PDF preview.
- [TeX Live](https://tug.org/texlive/) for the TeX distribution in the Docker image.
- Fonts: Instrument Sans, JetBrains Mono and Source Serif 4 (SIL Open Font License) via Google Fonts.
