
# 👾 AI Agent CLI Tool ~ Scaler Website Cloner

![alt text](image.png)

<br/>

----------

A conversational CLI agent that runs in the terminal and clones the Scaler  
Academy website into a working `index.html` / `style.css` / `script.js` set of files.  
Inspired by tools like Cursor and Windsurf, the agent reasons through the task in multiple steps  
rather than producing the whole site in a single response.

<br/>

> Built for **Assignment 02 — AI Agent CLI Tool**  
> Author: **Parv**

</div>

---

## What it does

You launch the CLI, type a natural-language instruction such as:

> Clone the Scaler website with header, hero, and footer into a folder called scaler_clone.

The agent then loops through a structured reasoning cycle — `START → THINK → TOOL → OBSERVE → THINK → ... → OUTPUT` — calling tools to fetch the live Scaler homepage, plan the layout, and write each file. The final output is a working static website you can open directly in a browser.

A pre-generated example output is included at [`scaler_clone/`](scaler_clone/) so you can see what a full run produces.

---

## Project structure

```text
.
├── index.js              # the CLI agent (entry point)
├── package.json          # node project config + scripts
├── .env.example          # template — copy to .env and fill in
├── .gitignore
├── scaler_clone/         # example output produced by the agent
│   ├── index.html        # main layout
│   ├── css/
│   │   └── style.css     # light-theme Scaler-style design system
│   ├── js/
│   │   └── script.js     # mobile nav, dropdowns, scroll reveal
│   └── images/
│       ├── favicon.png   # site icon
│       └── hero-image.jpg# tech illustration hero image
└── brutalist_blog/       # bonus: a separate brutalist blog UI demo
    ├── index.html
    ├── style.css
    └── script.js
```

---

## How the agent loop works

The agent is implemented as a strict state machine. Each model response produces exactly one JSON object whose `step` is one of:

| step      | meaning                                                    |
| --------- | ---------------------------------------------------------- |
| `START`   | Restates the user's goal in its own words                  |
| `THINK`   | A single reasoning step — the agent uses several of these  |
| `TOOL`    | Calls one tool (with `tool_name` + `tool_args`) then waits |
| `OUTPUT`  | The final answer to the user                               |

After every `TOOL` step the runtime executes the requested tool, captures the result, and feeds it back to the model as an `OBSERVE` message. The agent then continues thinking and deciding the next step. Nothing is produced in a single shot.

### Available tools

| Tool                            | Purpose                                                           |
| ------------------------------- | ----------------------------------------------------------------- |
| `executeCommand({ cmd })`       | Runs a shell command (`mkdir`, `ls`, etc.) — used for filesystem ops only |
| `writeFile({ path, content })`  | Writes a file. Creates parent directories. Used for all HTML/CSS/JS content |
| `readFile(path)`                | Reads back a file the agent previously wrote, so it can refine it |
| `fetchScalerSite()`             | Fetches the live `https://www.scaler.com` HTML (scripts/styles stripped) so the agent has a real reference for layout and copy |

The reason `writeFile` exists separately from `executeCommand` is to avoid the classic failure mode of trying to embed multi-line HTML inside a shell heredoc, which mangles quoting.

### Robustness features in `index.js`

- **Multi-provider support.** The agent uses the OpenAI SDK with a configurable `OPENAI_BASE_URL`, so it works against OpenAI, Anthropic's OpenAI-compat endpoint, or Gemini's OpenAI-compat endpoint by changing only the `.env`.
- **JSON-mode auto-detection.** Anthropic's compat endpoint rejects the `response_format: json_object` parameter, so the agent auto-disables JSON mode when the base URL contains `anthropic`. Override with `JSON_MODE=on/off`.
- **Code-fence stripping.** Some models wrap their JSON in ```json — the agent strips fences before parsing.
- **Balanced-brace recovery.** Smaller models occasionally emit two JSON objects back-to-back. `extractFirstJsonObject()` pulls the first balanced `{ ... }` block out of the response.
- **Step fixup.** If a model puts a tool name into the `step` field instead of `tool_name` (a common Gemini Flash Lite failure mode), the agent rewrites it to `step: "TOOL"`.
- **Bounded retries.** Three consecutive parse failures break the loop and print a helpful error rather than spinning forever.
- **Persistent history.** After the agent finishes a task, the conversation history persists, so follow-up instructions (e.g. *"now make the hero headline larger"*) can refine the previous output.

---

## Setup

### Prerequisites

- Node.js 18+
- An API key for one of: OpenAI, Anthropic (Claude), or Google Gemini

### Install

```bash
npm install
````

### Configure

```bash
cp .env.example .env
```

Then edit `.env`:

```env
# Anthropic (Claude) via OpenAI-compatible endpoint
OPENAI_API_KEY=sk-ant-...
OPENAI_BASE_URL=https://api.anthropic.com/v1/
MODEL=claude-haiku-4-5
```

Three provider blocks are pre-written in `.env.example` — just uncomment the one you want and comment out the others.

---

## Git Setup

To push this project to GitHub:

```bash
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/Parv-0210/Agentic-CLI-.git
git push -u origin main
```

> By Parv only, no Rajveer

---

## Run

```bash
npm start
```

You'll see:

```
Agent CLI ready. Type an instruction, or 'exit' to quit.
Model: claude-haiku-4-5
Try: Clone the Scaler website with header, hero, and footer into a folder called scaler_clone.

you >
```

Type your instruction and press enter. The agent will print each step as it thinks, calls tools, and observes results.

### Example session

```
you > Clone the Scaler website with header, hero, and footer into a folder called scaler_clone.

[START] User wants a Scaler homepage clone in a folder called scaler_clone, with header, hero, and footer.
[THINK] I should fetch the live site first so I have a real reference for copy and structure.
[TOOL ] fetchScalerSite()
[OBS  ] <!doctype html><html lang="en"><head><meta charset="utf-8">...
[THINK] The site uses a light theme with teal accents. I will mirror that.
[TOOL ] executeCommand({"cmd":"mkdir -p scaler_clone"})
[OBS  ] (command "mkdir -p scaler_clone" finished with no output)
[THINK] Now write index.html with semantic header, hero, footer.
[TOOL ] writeFile({"path":"scaler_clone/index.html","content":"<!doctype html>..."})
[OBS  ] Wrote 14182 chars to scaler_clone/index.html
... (continues through style.css and script.js) ...

[OUTPUT] Done. Open scaler_clone/index.html in a browser to view the clone.
```

---

## View the generated site

```bash
# Quick local server (no install)
npm run serve
# or:
python3 -m http.server 5173 --directory scaler_clone
```

Then visit **[http://127.0.0.1:5173/](http://127.0.0.1:5173/)**.

---

## Bonus: brutalist blog

The [`brutalist_blog/`](brutalist_blog/) folder is a separate static site that demonstrates a brutalist UI direction.

```bash
python3 -m http.server 5174 --directory brutalist_blog
```

---

## Tech stack

* **Node.js** (ES modules)
* **OpenAI SDK** (`openai` npm package)
* **axios**
* **dotenv**
* No build step. No bundler. The CLI is a single file.

---

## Submission

| Item                | Status                                |
| ------------------- | ------------------------------------- |
| GitHub repo         | *add link here once pushed*           |
| YouTube demo (2–3m) | *add link here once recorded*         |
| Agent loop          | Implemented in [`index.js`](index.js) |
| Generated site      | [`scaler_clone/`](scaler_clone/)      |
| Documentation       | This README                           |

---

## License / attribution

This project is a learning exercise. The cloned page imitates the structure and look of the public Scaler homepage; copy was rewritten in original wording, no Scaler image assets were used, and the page links to fonts from Google Fonts only.

---

<div align="center">

**Built by Parv** 🧃
