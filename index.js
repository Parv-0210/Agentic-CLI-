import "dotenv/config";
import axios from "axios";
import { OpenAI } from "openai";
import { exec } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import readline from "readline";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || undefined,
});

const MODEL = process.env.MODEL || "gpt-4.1-mini";

// Anthropic's OpenAI-compat endpoint rejects response_format. Auto-detect from
// base URL, or override with JSON_MODE=on|off in .env.
const JSON_MODE = (() => {
  const explicit = (process.env.JSON_MODE || "").toLowerCase();
  if (explicit === "on") return true;
  if (explicit === "off") return false;
  const base = process.env.OPENAI_BASE_URL || "";
  return !base.includes("anthropic");
})();

// ---------- Tools ----------

async function executeCommand(args) {
  const cmd = typeof args === "string" ? args : args?.cmd;
  if (!cmd) return "ERROR: no command provided";
  return new Promise((resolve) => {
    exec(cmd, { cwd: process.cwd(), maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolve(`ERROR: ${err.message}\n${stderr || ""}`);
      resolve(stdout || stderr || `(command "${cmd}" finished with no output)`);
    });
  });
}

function parseArgs(args) {
  if (typeof args === "string") {
    try { return JSON.parse(args); } catch { return { _raw: args }; }
  }
  return args || {};
}

async function writeFile(args) {
  const { path: filePath, content } = parseArgs(args);
  if (!filePath || typeof content !== "string") {
    return "ERROR: writeFile needs { path, content }";
  }
  const abs = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return `Wrote ${content.length} chars to ${filePath}`;
}

async function readFile(args) {
  const filePath = typeof args === "string" ? args : args?.path;
  if (!filePath) return "ERROR: readFile needs a path";
  const abs = path.resolve(process.cwd(), filePath);
  const data = await fs.readFile(abs, "utf8");
  return data;
}

async function fetchScalerSite() {
  const url = "https://www.scaler.com/";
  const { data } = await axios.get(url, {
    headers: { "User-Agent": "Mozilla/5.0 (agent-cli)" },
    timeout: 15000,
  });
  const cleaned = data
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 8000);
  return cleaned;
}

const tool_map = {
  executeCommand,
  writeFile,
  readFile,
  fetchScalerSite,
};

// ---------- System prompt ----------

const SYSTEM_PROMPT = `
You are an AI coding agent that runs in a terminal — similar to Cursor or Windsurf.
You operate in a strict loop: START -> THINK -> TOOL -> OBSERVE -> THINK -> ... -> OUTPUT.
You take ONE step per response and wait for the next message before continuing.

Available tools:
1. executeCommand(cmd: string)
   Runs a shell command on the user's machine (mkdir, ls, etc.).
   Use ONLY for filesystem ops, NOT for writing file contents.
2. writeFile({ path: string, content: string })
   Writes a file. Creates parent directories automatically.
   Use this for ALL HTML/CSS/JS file content — never use echo or heredoc through executeCommand.
3. readFile(path: string)
   Reads a file you previously wrote so you can refine it.
4. fetchScalerSite()
   Fetches the live https://www.scaler.com homepage HTML (scripts/styles stripped) so you have real reference for layout, copy, colors, and section structure. Call this BEFORE designing a Scaler clone.

Rules:
1. Always respond with EXACTLY ONE valid JSON object — nothing else. No prose, no markdown, no code fences, no second JSON object after the first.
2. The "step" field MUST be exactly one of these four literal strings: "START", "THINK", "TOOL", "OUTPUT". Never put a tool name in "step". Tool names ALWAYS go in "tool_name", and "step" stays as "TOOL".
3. One step per response. After a TOOL step, STOP and wait for the OBSERVE message before producing your next step.
4. Do multiple THINK steps before any TOOL or OUTPUT — break the problem down step by step.
5. For Scaler-clone tasks: fetchScalerSite first, THINK about structure (header / hero / footer), then mkdir the project folder, then writeFile each file (index.html, style.css, script.js), then OUTPUT instructions to open the file in a browser.
6. Generated HTML must be self-contained, semantic, responsive (mobile-friendly via media queries), and link external CSS/JS by relative path. Write your own original copy — do NOT paste any text or markup verbatim from the fetched site.

7. Visual design spec (Scaler.com is a LIGHT-THEME ed-tech site — do not use a dark navy palette):

   COLOR PALETTE
   - Body background: pure white (#ffffff)
   - Section backgrounds: alternate between #ffffff and a very light gray (#f7f8fa or #fafbfc)
   - Primary brand accent (used for CTA buttons, links, badges, highlights): teal/turquoise around #00A699 to #0FB6A4
   - Secondary accent: a slightly darker teal for hover (#008C82)
   - Heading text: near-black charcoal (#0f172a or #14171a)
   - Body text: medium gray (#475569 or #4a5568)
   - Muted text / captions: lighter gray (#94a3b8)
   - Borders / dividers: very light gray (#e5e7eb)
   - Footer background: dark charcoal (#0f172a or #111827) with white text — this is the ONLY dark area on the page

   TYPOGRAPHY
   - Use a modern geometric sans-serif via Google Fonts: Inter, Manrope, or Poppins (pick one and import it). Weights 400 / 500 / 600 / 700.
   - Hero headline: ~3rem to 3.5rem, weight 700, tight line-height (1.1), charcoal color
   - Section headings: ~2rem, weight 600
   - Body: 1rem, line-height 1.6, medium gray
   - Small/caption: 0.875rem

   HEADER
   - White background, sits at the top, subtle bottom border (#e5e7eb) or 0–4px soft shadow on scroll
   - Height around 72–80px, max-width container ~1200px, horizontal padding ~24px
   - Logo on the left (use a simple text-logo styled with brand color, e.g. the word "Scaler" in teal weight 700, since we are not copying their image asset)
   - Center/right: nav links (categories like Programs, Courses, Resources, For Business — use generic ed-tech category names you write yourself) — gray text, hover turns teal
   - Far right: a "Login" text link plus a filled teal CTA button ("Apply Now" or similar — your wording, not theirs)

   HERO
   - Two-column layout on desktop (text left, illustration/visual right), stacks to single column on mobile
   - Above the headline: a small pill-shaped badge with light teal background and teal text (e.g. "New cohort starting soon" — your copy)
   - Headline: bold, multi-line, uses 2 colors — most words charcoal, one keyword highlighted in teal
   - Subtext: 2 short lines of medium-gray copy explaining the value proposition
   - Two CTAs side by side: primary filled teal button + secondary ghost/outline button
   - Right column visual: use a CSS-drawn illustration OR a placeholder image element — do NOT hotlink Scaler's images. Acceptable: a styled card showing a fake course preview, or a gradient shape, or an inline SVG you compose.
   - Below hero: a thin "trusted by" strip with 4–6 grayed-out fake/generic company name texts in a row (you invent the names, e.g. "Acme", "Globex", "Initech")

   FOOTER
   - Dark charcoal background (#0f172a) with white/light-gray text
   - 4-column link grid on desktop (e.g. Programs / Company / Resources / Legal) collapsing to single column on mobile
   - Top of footer: brand logo + 1-line tagline + small social icon row (use inline SVGs or unicode symbols, not external assets)
   - Bottom row: thin divider, then copyright + secondary links (Privacy / Terms) — your wording

   COMPONENTS / VIBE
   - Buttons: 8px border-radius, ~12px vertical / 24px horizontal padding, weight 600, no harsh shadow. Primary = filled teal + white text; secondary = transparent + teal border + teal text. Hover: darken by ~10%.
   - Cards: white background, 12px radius, very subtle shadow (e.g. 0 4px 20px rgba(15,23,42,0.06)), 24–32px internal padding
   - Generous whitespace between sections (80–120px vertical padding)
   - Container max-width 1200px, centered, 24px side padding
   - Premium / trustworthy / institutional feel — not playful, not flashy

8. Never invent tools. The available tools are exactly: executeCommand, writeFile, readFile, fetchScalerSite. If a tool name doesn't appear in that list it does not exist.

JSON format (one object only, all fields on the same JSON object):
{ "step": "START" | "THINK" | "TOOL" | "OUTPUT", "content": "string", "tool_name": "string (only when step is TOOL)", "tool_args": "string or object (only when step is TOOL)" }

Example (small task):
user: Create a folder called demo and put a hello.txt inside it saying hi.
assistant: { "step": "START", "content": "User wants a folder 'demo' with a file 'hello.txt' containing 'hi'." }
assistant: { "step": "THINK", "content": "I will mkdir demo, then writeFile demo/hello.txt with content 'hi'." }
assistant: { "step": "TOOL", "tool_name": "executeCommand", "tool_args": "mkdir -p demo" }
user: { "step": "OBSERVE", "content": "(command \\"mkdir -p demo\\" finished with no output)" }
assistant: { "step": "THINK", "content": "Folder created. Now write the file." }
assistant: { "step": "TOOL", "tool_name": "writeFile", "tool_args": { "path": "demo/hello.txt", "content": "hi" } }
user: { "step": "OBSERVE", "content": "Wrote 2 chars to demo/hello.txt" }
assistant: { "step": "OUTPUT", "content": "Done. Folder 'demo' with hello.txt is ready. Run: cat demo/hello.txt" }
`;

// ---------- Agent loop ----------

function stripFences(s) {
  // strip ```json ... ``` or ``` ... ``` wrappers Gemini sometimes emits
  return s
    .replace(/^﻿/, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

// Extract the first balanced { ... } block, ignoring anything before/after.
// Handles the common Gemini Flash Lite failure mode of emitting two JSON
// objects back-to-back (which JSON.parse rejects).
function extractFirstJsonObject(s) {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

async function runAgent(userInput, history) {
  history.push({ role: "user", content: userInput });

  let parseFailures = 0;
  const MAX_PARSE_FAILURES = 3;

  while (true) {
    let response;
    try {
      const params = {
        model: MODEL,
        messages: history,
        max_tokens: 8192,
      };
      if (JSON_MODE) params.response_format = { type: "json_object" };
      response = await client.chat.completions.create(params);
    } catch (err) {
      console.error(`\n[api error] ${err.message}`);
      if (err.status) console.error(`[status] ${err.status}`);
      if (err.error) console.error(`[error]  ${JSON.stringify(err.error).slice(0, 800)}`);
      if (err.code) console.error(`[code]   ${err.code}`);
      if (err.type) console.error(`[type]   ${err.type}`);
      console.error("");
      return;
    }

    const raw = response.choices[0]?.message?.content || "";
    if (!raw.trim()) {
      console.error(`\n[empty response] model returned no content. finish_reason=${response.choices[0]?.finish_reason}\n`);
      return;
    }

    let parsed;
    const cleaned = stripFences(raw);
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // fallback: extract first balanced { ... } and ignore trailing garbage
      const firstObj = extractFirstJsonObject(cleaned);
      if (firstObj) {
        try {
          parsed = JSON.parse(firstObj);
          console.log(`[recovered] ignored ${cleaned.length - firstObj.length} trailing chars after first JSON object`);
        } catch {}
      }
      if (!parsed) {
        parseFailures++;
        console.log(`[parse-fail #${parseFailures}] ${e.message}`);
        console.log(`[raw] ${raw.slice(0, 400)}${raw.length > 400 ? "...[truncated]" : ""}`);
        if (parseFailures >= MAX_PARSE_FAILURES) {
          console.error(`\n[giving up] model produced invalid JSON ${MAX_PARSE_FAILURES} times in a row. Try a stronger model (e.g. MODEL=gemini-2.5-flash).\n`);
          return;
        }
        history.push({ role: "assistant", content: raw });
        history.push({
          role: "user",
          content: JSON.stringify({
            step: "OBSERVE",
            content: `Your last message was not valid JSON (${e.message}). Respond with EXACTLY ONE valid JSON object — no markdown fences, no prose, no second object after the first. Escape newlines inside string values as \\n.`,
          }),
        });
        continue;
      }
    }
    parseFailures = 0;

    // Salvage: Gemini Flash Lite sometimes puts the tool name in "step"
    // (e.g. {"step":"writeFile","tool_name":"writeFile",...}). If "step" is
    // not canonical but matches a known tool, rewrite it to "TOOL".
    if (parsed.step && !["START", "THINK", "TOOL", "OUTPUT"].includes(parsed.step) && tool_map[parsed.step]) {
      console.log(`[fixup] rewriting step="${parsed.step}" -> step="TOOL"`);
      if (!parsed.tool_name) parsed.tool_name = parsed.step;
      parsed.step = "TOOL";
    }

    history.push({ role: "assistant", content: JSON.stringify(parsed) });

    const step = parsed.step;
    if (step === "START") {
      console.log(`\n[START] ${parsed.content}`);
      history.push({ role: "user", content: "Proceed with the next step." });
    } else if (step === "THINK") {
      console.log(`[THINK] ${parsed.content}`);
      history.push({ role: "user", content: "Proceed with the next step." });
    } else if (step === "TOOL") {
      const name = parsed.tool_name;
      const argPreview =
        typeof parsed.tool_args === "object"
          ? JSON.stringify(parsed.tool_args).slice(0, 100)
          : String(parsed.tool_args).slice(0, 100);
      console.log(`[TOOL ] ${name}(${argPreview}${argPreview.length >= 100 ? "..." : ""})`);

      let observation;
      if (!tool_map[name]) {
        observation = `Tool "${name}" is not available.`;
      } else {
        try {
          observation = await tool_map[name](parsed.tool_args);
        } catch (err) {
          observation = `Tool error: ${err.message}`;
        }
      }
      const obsStr = typeof observation === "string" ? observation : JSON.stringify(observation);
      const obsTrunc = obsStr.length > 8000 ? obsStr.slice(0, 8000) + "...[truncated]" : obsStr;
      const preview = obsTrunc.replace(/\s+/g, " ").slice(0, 160);
      console.log(`[OBS  ] ${preview}${obsTrunc.length > 160 ? "..." : ""}`);

      history.push({
        role: "user",
        content: JSON.stringify({ step: "OBSERVE", content: obsTrunc }),
      });
    } else if (step === "OUTPUT") {
      console.log(`\n[OUTPUT] ${parsed.content}\n`);
      return;
    } else {
      console.log(`[warn ] unknown step "${step}" — asking model to retry with valid step`);
      history.push({
        role: "user",
        content: JSON.stringify({
          step: "OBSERVE",
          content: `Your "step" field was "${step}", which is not valid. The "step" field MUST be exactly one of: "START", "THINK", "TOOL", "OUTPUT". To call a tool, set "step":"TOOL" and put the tool name in "tool_name". Do not change anything else; just resend with the correct step.`,
        }),
      });
    }
  }
}

// ---------- CLI ----------

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in .env (copy .env.example to .env first).");
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  console.log("Agent CLI ready. Type an instruction, or 'exit' to quit.");
  console.log(`Model: ${MODEL}`);
  console.log("Try: Clone the Scaler website with header, hero, and footer into a folder called scaler_clone.\n");

  const history = [{ role: "system", content: SYSTEM_PROMPT }];

  while (true) {
    const input = (await ask("you > ")).trim();
    if (!input) continue;
    if (input === "exit" || input === "quit") {
      rl.close();
      return;
    }
    try {
      await runAgent(input, history);
    } catch (err) {
      console.error(`\n[error] ${err.message}\n`);
    }
  }
}

main();
