# TeX Compiler

A simple, beginner-friendly web app for turning LaTeX into a PDF. Write or upload a LaTeX project, press **Compile**, and preview the PDF. If compilation fails, the app shows TeX's error, the file and line (click to jump there), a plain-English hint, and the full compiler log.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer. There are no npm dependencies to install.

```sh
npm start
```

Then open <http://127.0.0.1:3000>. Press **Ctrl + C** in the terminal to stop the server.

## Using the app

- **Sidebar menu.** Use **New file**, **Upload files**, **Upload folder** and **Reset to example**. You can also drag files or a whole folder onto the Files list.
- **Files.** Click a file to edit it. Images show a preview and the `\includegraphics` line to use. The file marked **main** is the one that gets compiled. To change it, open another `.tex` file and choose **Set as main**.
- **Uploading a folder.** The folder becomes your project. The app picks `main.tex`, or the file containing `\documentclass`, as the main file. It skips build files (`.aux`, `.log`, …) and hidden files.
- **Compiling.** Click **Compile**, or press **Ctrl/⌘ + Enter**. Before compiling, the app checks for:
  - a missing `.bib` file
  - missing images or `\input` files
  - `\cite` keys that aren't in your `.bib` file

  These checks run in your browser, so you get warnings even when TeX still produces a PDF.
- **Keyboard.** **Tab** moves focus out of the editor instead of inserting a tab, so the whole page works with a keyboard.
- **Saving.** Your project is saved in this browser automatically (IndexedDB).

Bibliographies work with both BibTeX (`\bibliography{references}`) and biblatex/Biber (`\addbibresource{references.bib}`). Upload the `.bib` file next to your main file.

## How compilation works

The browser sends all project files to this app's server (`POST /api/compile`). The server compiles them in one of two ways:

| Backend | When it's used | Notes |
|---------|----------------|-------|
| **local** | A TeX distribution (`pdflatex`, `xelatex`, `lualatex`) is installed on the server | Runs in a temporary folder with shell escape disabled, then BibTeX or Biber if needed, then reruns TeX so citations and references resolve. |
| **remote** | No local TeX is found | Sends the project to the free [LaTeX-on-HTTP](https://github.com/YtoTech/latex-on-http) service at `latex.ytotech.com`, which runs a full TeX Live with latexmk. **Your files leave your machine.** |

By default (`TEX_BACKEND=auto`) the server uses local TeX if it can find it, and the online service otherwise. The terminal shows which one is active at startup, and the preview footer shows which one compiled each PDF.

The app shows a PDF only if a real PDF came back. If the compiler can't be reached or times out, you get an error saying so.

### Install TeX locally (optional, recommended for private documents)

- **macOS:** [MacTeX](https://www.tug.org/mactex/), or `brew install --cask basictex` for a smaller install
- **Linux:** `sudo apt install texlive-latex-recommended texlive-latex-extra texlive-bibtex-extra biber` (Debian/Ubuntu)
- **Windows:** [MiKTeX](https://miktex.org) or [TeX Live](https://tug.org/texlive/)

Restart the server after installing so it detects the new engines.

## Configuration

Set these as environment variables, e.g. `TEX_BACKEND=remote PORT=8080 npm start`.

| Variable | Default | Meaning |
|----------|---------|---------|
| `TEX_BACKEND` | `auto` | `auto`, `local` (only use installed TeX), or `remote` (always use the web service) |
| `TEX_REMOTE_URL` | `https://latex.ytotech.com/builds/sync` | Remote compile endpoint. Must speak the LaTeX-on-HTTP API, so you can point it at your own self-hosted instance |
| `TEX_TIMEOUT_MS` | `90000` | Stop compiling after this many milliseconds |
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to bind. Use `0.0.0.0` to allow other devices on your network |

Limits: 300 files and 25 MB per project, 10 MB per file.

## Tests

```sh
npm test
```

The tests cover the log parser (TeX, BibTeX and Biber output → error list) and the browser-side project checks.

## Project layout

```
server.js              HTTP server: static files + /api/compile
lib/compile.js         Local and remote compiler backends
lib/project.js         Validates uploaded projects (paths, sizes, main file)
lib/parse-log.js       Extracts errors, files, line numbers and hints from logs
public/index.html      The page
public/styles.css      Styles (light and dark)
public/js/app.js       UI: sidebar, editor, preview, dialogs
public/js/project.js   File types, uploads, starter example, pre-compile checks
public/js/store.js     Saves the project in the browser
test/                  Unit tests
```

## A note on security

The local backend disables shell escape and limits TeX's file access to the project folder, but compiling untrusted LaTeX is still risky. If you expose this app to the internet with the local backend, run it inside a container or sandbox, and add rate limiting.
