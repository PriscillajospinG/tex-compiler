# TeX Compiler

A simple, beginner-friendly web app for turning LaTeX into a PDF. Write or paste LaTeX, press **Compile**, and preview the PDF. If compilation fails, the app shows TeX's error, the line number (click it to jump there in the editor), a plain-English hint, and the full compiler log.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer. There are no npm dependencies to install.

```sh
npm start
```

Then open <http://127.0.0.1:3000>.

Keyboard shortcuts: **Ctrl/⌘ + Enter** compiles. **Tab** moves focus out of the editor (it does not insert a tab), so the whole page can be used with a keyboard.

Your draft is saved in the browser automatically. **Reset example** restores the starter document.

## How compilation works

The browser sends your LaTeX to this app's server (`POST /api/compile`). The server compiles it in one of two ways:

| Backend  | When it's used | Notes |
|----------|----------------|-------|
| **local**  | A TeX distribution (`pdflatex`, `xelatex`, `lualatex`) is installed on the server | Runs in a temporary folder with shell escape disabled, up to two passes so `\ref` and tables of contents resolve. |
| **remote** | No local TeX is found | Sends the document to the free [texlive.net](https://texlive.net) service, which runs a full, current TeX Live. Your document leaves your machine. |

By default (`TEX_BACKEND=auto`) the server uses local TeX if it can find it, and texlive.net otherwise. The terminal shows which one is active at startup, and the app shows which one compiled each PDF.

The app only shows a PDF if a real PDF came back. If the compiler can't be reached or times out, you get an error saying so.

### Install TeX locally (optional)

- **macOS:** [MacTeX](https://www.tug.org/mactex/), or `brew install --cask basictex` for a smaller install
- **Linux:** `sudo apt install texlive-latex-recommended texlive-latex-extra` (Debian/Ubuntu)
- **Windows:** [MiKTeX](https://miktex.org) or [TeX Live](https://tug.org/texlive/)

Restart the server after installing so it detects the new engines.

## Configuration

Set these as environment variables, e.g. `TEX_BACKEND=remote PORT=8080 npm start`.

| Variable | Default | Meaning |
|----------|---------|---------|
| `TEX_BACKEND` | `auto` | `auto`, `local` (only use installed TeX), or `remote` (always use the web service) |
| `TEX_REMOTE_URL` | `https://texlive.net/cgi-bin/latexcgi` | Remote compile endpoint. It must accept the texlive.net form fields (`filecontents[]`, `filename[]`, `engine`, `return=pdf`) |
| `TEX_TIMEOUT_MS` | `60000` | Stop compiling after this many milliseconds |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to bind. Use `0.0.0.0` to allow other devices on your network |

## Tests

```sh
npm test
```

These test the log parser that turns TeX output into the error list.

## Project layout

```
server.js            HTTP server: static files + /api/compile
lib/compile.js       Local and remote compiler backends
lib/parse-log.js     Extracts errors, line numbers and hints from TeX logs
public/              The web page (HTML, CSS, JS — no build step)
test/                Unit tests
```

## A note on security

The local backend disables shell escape and limits TeX's file access to its temporary folder, but compiling untrusted LaTeX is still risky. If you expose this app to the internet with the local backend, run it inside a container or sandbox, and add rate limiting.
