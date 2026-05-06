import "dotenv/config";
import axios from "axios";
import { OpenAI } from "openai";
import { exec } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import readline from "readline";
import figlet from "figlet";

// Wrap figlet in a proper Promise (avoids promisify deprecation on Promise-returning fns)
const figletAsync = (text, opts) =>
  new Promise((resolve, reject) =>
    figlet.text(text, opts, (err, result) => (err ? reject(err) : resolve(result)))
  );

// ---------- Startup Banner ----------

async function printBanner() {
  const text = await figletAsync("RAJVEER42", { font: "ANSI Shadow" });
  const lines = text.split("\n");

  // Gradient: blue-purple (#6060FF) -> hot-pink (#FF40CC)
  const startRGB = [96, 96, 255];  // blue-purple
  const endRGB   = [255, 64, 204]; // hot-pink

  const maxLen = Math.max(...lines.map((l) => l.length)) || 1;

  const colored = lines.map((line) =>
    line
      .split("")
      .map((char, i) => {
        const t = i / maxLen;
        const r = Math.round(startRGB[0] + t * (endRGB[0] - startRGB[0]));
        const g = Math.round(startRGB[1] + t * (endRGB[1] - startRGB[1]));
        const b = Math.round(startRGB[2] + t * (endRGB[2] - startRGB[2]));
        return `\x1b[38;2;${r};${g};${b}m${char}`;
      })
      .join("") + "\x1b[0m"
  );

  console.log("\n" + colored.join("\n") + "\n");
}

const client = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: process.env.GEMINI_BASE_URL || undefined,
});

const MODEL = process.env.MODEL || "gpt-4.1-mini";

// Anthropic's OpenAI-compat endpoint rejects response_format. Auto-detect from
// base URL, or override with JSON_MODE=on|off in .env.
const JSON_MODE = (() => {
  const explicit = (process.env.JSON_MODE || "").toLowerCase();
  if (explicit === "on") return true;
  if (explicit === "off") return false;
  const base = process.env.GEMINI_BASE_URL || "";
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
  // Tiny placeholder writes: refuse outright.
  if (content.length < 200 && /add (css|js|html) styles? here|TODO|placeholder/i.test(content)) {
    return `ERROR: refusing to write a stub/placeholder file. Write real, complete content for ${filePath}.`;
  }
  // HTML comment-skeleton detection: <body> exists but visible text under threshold.
  if (/\.html?$/i.test(filePath)) {
    const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      const visible = bodyMatch[1]
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (visible.length < 120) {
        return `ERROR: refusing to write ${filePath} — body has only ${visible.length} chars of visible text after stripping tags and comments. Write the FULL real content (logo word, nav labels, headline, subtext, button labels, company names, footer copy) in this same writeFile call. Do not scaffold with <!-- Header Content --> placeholders.`;
      }
    }
  }
  // CSS punctuation sanity: Arabic comma (U+060C) and semicolon (U+061B) silently invalidate selectors/rules.
  if (/\.css$/i.test(filePath) && /[،؛]/.test(content)) {
    return `ERROR: refusing to write ${filePath} — contains non-ASCII punctuation (Arabic comma U+060C or semicolon U+061B) which invalidates CSS rules. Use ASCII "," and ";" only.`;
  }
  // HTML must include a logo and must not reference placeholder image files that will 404.
  if (/\.html?$/i.test(filePath) && /<header[\s\S]*?<\/header>/i.test(content)) {
    if (!/class\s*=\s*["'][^"']*\blogo\b/i.test(content)) {
      return `ERROR: refusing to write ${filePath} — header has no logo element. Include <a class="logo">Scaler</a> as the first element inside the header so the nav row has a left anchor.`;
    }
    if (/<img[^>]+src\s*=\s*["'](?:company\d|logo\d|placeholder|sample)[^"']*["']/i.test(content)) {
      return `ERROR: refusing to write ${filePath} — references placeholder image files (e.g. <img src="company1.png">) that will 404. Use plain text company names in <a> tags instead, e.g. <li><a href="#">Acme</a></li>.`;
    }
  }
  // HTML must not contain literal template placeholder strings — the model has to actually fill them in.
  if (/\.html?$/i.test(filePath)) {
    const leak = content.match(/YOUR_HEADLINE_PART_(?:ONE|TWO)|YOUR_BADGE_TEXT|YOUR_TWO_LINE_VALUE_PROP_SUBTEXT|YOUR_ONE_LINE_TAGLINE|ACCENT_WORD/);
    if (leak) {
      return `ERROR: refusing to write ${filePath} — contains literal template placeholder "${leak[0]}". The skeleton in the system prompt is a STRUCTURAL template; you must replace every placeholder string with real, original copy before writing. Example replacements: YOUR_BADGE_TEXT -> "Spring 2026 cohort opens soon"; YOUR_HEADLINE_PART_ONE / ACCENT_WORD / YOUR_HEADLINE_PART_TWO -> "Build the engineering / career / you actually want."; YOUR_TWO_LINE_VALUE_PROP_SUBTEXT -> "Live classes, hands-on AI tooling, and one-on-one mentorship from senior engineers. Ship a portfolio you can defend in any interview."; YOUR_ONE_LINE_TAGLINE -> "Skills that compound. Built for engineers who keep learning."`;
    }
  }
  const abs = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return `Wrote ${content.length} chars to ${filePath}`;
}

async function appendFile(args) {
  const { path: filePath, content } = parseArgs(args);
  if (!filePath || typeof content !== "string") {
    return "ERROR: appendFile needs { path, content }";
  }
  if (/\.css$/i.test(filePath) && /[،؛]/.test(content)) {
    return `ERROR: refusing to append to ${filePath} — contains non-ASCII punctuation (Arabic comma U+060C or semicolon U+061B). Use ASCII "," and ";" only.`;
  }
  const abs = path.resolve(process.cwd(), filePath);
  try {
    await fs.access(abs);
  } catch {
    return `ERROR: ${filePath} does not exist yet — create it first with writeFile.`;
  }
  await fs.appendFile(abs, content, "utf8");
  return `Appended ${content.length} chars to ${filePath}`;
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

  // -- structured extraction so the model gets grounding, not just HTML soup --
  const pick = (re, n = 12) => {
    const out = [];
    let m;
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    while ((m = r.exec(data)) && out.length < n) out.push(m[1].replace(/\s+/g, " ").trim());
    return out.filter(Boolean);
  };

  const titleMatch = data.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDesc = data.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  const themeColor = data.match(/<meta\s+name=["']theme-color["']\s+content=["']([^"']+)["']/i);

  const headings = [
    ...pick(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, 6),
    ...pick(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, 10),
  ].map((s) => s.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
  const navItems = pick(/<a[^>]*class=["'][^"']*nav[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, 12)
    .map((s) => s.replace(/<[^>]+>/g, "").trim());
  const buttons = pick(/<(?:button|a)[^>]*class=["'][^"']*(?:btn|button|cta)[^"']*["'][^>]*>([\s\S]*?)<\/(?:button|a)>/gi, 12)
    .map((s) => s.replace(/<[^>]+>/g, "").trim())
    .filter((t) => t && t.length < 40);

  // primary brand color hints — Scaler uses teal #00A699
  const colorHints = [
    ...new Set(
      (data.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || [])
        .filter((c) => c.length === 7) // 6-digit only
        .slice(0, 80)
    ),
  ].slice(0, 12);

  const cleaned = data
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 6000);

  const summary = [
    "=== SCALER.COM STRUCTURAL SUMMARY (extracted, use as design grounding) ===",
    `TITLE: ${titleMatch ? titleMatch[1].trim() : "(none)"}`,
    `META_DESCRIPTION: ${metaDesc ? metaDesc[1].trim() : "(none)"}`,
    `THEME_COLOR: ${themeColor ? themeColor[1].trim() : "(none)"}`,
    `HEADINGS: ${JSON.stringify(headings.slice(0, 12))}`,
    `NAV_ITEMS: ${JSON.stringify(navItems.slice(0, 8))}`,
    `BUTTON_LABELS: ${JSON.stringify(buttons.slice(0, 8))}`,
    `COLORS_DETECTED: ${JSON.stringify(colorHints)}`,
    "=== RAW HTML EXCERPT (first 6000 chars, scripts/styles stripped) ===",
    cleaned,
  ].join("\n");

  return summary;
}

const tool_map = {
  executeCommand,
  writeFile,
  appendFile,
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
   Writes (or overwrites) a file. Creates parent directories automatically.
   Use this for ALL HTML/CSS/JS file content — never use echo or heredoc through executeCommand.
   The runtime REJECTS stub/placeholder writes (e.g. "/* Add CSS styles here */"). Always write real content.
3. appendFile({ path: string, content: string })
   Appends to an existing file. Use this to BUILD UP style.css in multiple passes
   (one section per call) so a single response never has to fit the entire stylesheet.
   Recommended CSS pass plan:
     pass 1: writeFile  -> reset + variables + base typography
     pass 2: appendFile -> .container + header + nav
     pass 3: appendFile -> .hero (and any sub-blocks)
     pass 4: appendFile -> trusted-by / company strip
     pass 5: appendFile -> footer
     pass 6: appendFile -> @media queries (responsive)
4. readFile(path: string)
   Reads a file you previously wrote so you can refine it.
5. fetchScalerSite()
   Fetches the live https://www.scaler.com homepage. Returns a STRUCTURAL SUMMARY
   (title, meta description, theme color, headings, nav items, button labels, color hex codes)
   followed by a 6000-char HTML excerpt. Call this BEFORE designing a Scaler clone — use the
   extracted nav items, button labels and colors as your grounding.

Rules:
1. Always respond with EXACTLY ONE valid JSON object — nothing else. No prose, no markdown, no code fences, no second JSON object after the first.
2. The "step" field MUST be exactly one of these four literal strings: "START", "THINK", "TOOL", "OUTPUT". Never put a tool name in "step". Tool names ALWAYS go in "tool_name", and "step" stays as "TOOL".
3. One step per response. After a TOOL step, STOP and wait for the OBSERVE message before producing your next step.
4. Do multiple THINK steps before any TOOL or OUTPUT — break the problem down step by step.
5. For Scaler-clone tasks, follow this ORDER:
     a. fetchScalerSite() and read the structural summary it returns.
     b. THINK about structure (header / hero / trusted-by / footer) — multiple THINK steps.
     c. executeCommand("mkdir -p <folder>") to create the project folder.
     d. writeFile <folder>/index.html — full, properly indented HTML on multiple lines.
     e. writeFile <folder>/style.css — pass 1: reset + :root variables + base typography ONLY.
     f. appendFile <folder>/style.css — pass 2: header + nav.
     g. appendFile <folder>/style.css — pass 3: hero.
     h. appendFile <folder>/style.css — pass 4: trusted-by / company strip.
     i. appendFile <folder>/style.css — pass 5: footer.
     j. appendFile <folder>/style.css — pass 6: @media responsive rules.
     k. writeFile <folder>/script.js — real interactivity (sticky-header shadow toggle, mobile menu toggle, smooth scroll).
     l. OUTPUT instructions to open <folder>/index.html in a browser.

6. HTML quality rules (ALL required):
   - Multi-line, indented HTML. NEVER emit minified single-line HTML — it is unreviewable.
   - Semantic tags: <header>, <nav>, <main>, <section>, <footer>.
   - Self-contained: link external style.css and script.js by relative path; no inline <style>; no inline event handlers.
   - Responsive viewport meta + media queries in CSS.
   - Original wording — do NOT copy verbatim from the fetched site.
   - HTML must be COMPLETE in ONE writeFile call. Never write a comment-only skeleton like
     <header><!-- Header Content --></header> intending to fill it in later. The runtime
     rejects HTML where <body> contains less than ~120 chars of visible text after stripping
     comments and tags. Every <header>, <nav>, <section>, <footer> in this single writeFile
     call must contain its real content: logo word, nav link labels, hero headline + subtext,
     pill badge text, two CTA labels, ~6 company names for the trusted strip, and footer copy.
   - Use the matching CSS selectors. If your CSS targets ".trusted-by ul li a", the HTML must
     contain that exact <section class="trusted-by"><ul><li><a>...</a></li>...</ul></section>
     structure. If your CSS targets "nav { display: flex }", the HTML element must be <nav>,
     not <navigation>.

7. CSS quality checklist (ALL required — runtime will visually inspect output):
   - Real, complete CSS. NEVER write a stub like "/* Add CSS styles here */". The runtime rejects stubs.
   - ASCII punctuation ONLY. Use "," (U+002C) and ";" (U+003B) — never the Arabic comma "،" (U+060C)
     or Arabic semicolon "؛" (U+061B). The runtime rejects CSS containing these — they silently invalidate
     the entire selector list, e.g. "*، *::before, *::after { ... }" applies to nothing.
   - Reset: "*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }".
   - Lists: every <ul> in nav and content rows MUST have "list-style: none;" — bullets must NOT appear in the rendered nav or company strip.
   - Container: define a ".container" or apply "max-width: 1200px; margin: 0 auto; padding: 0 24px;" to header / sections / footer so they don't span 100vw flush.
   - Header nav: horizontal flexbox row (display: flex; align-items: center; justify-content: space-between). Logo left, nav links centered or grouped, CTAs right. Hover states on every link.
   - Buttons: padding ~12px 24px, border-radius 8px, font-weight 600, distinct primary (filled teal) and secondary (outlined teal) variants, hover transitions.
   - Hero: large heading (clamp or ~3rem desktop), pill badge, two CTAs side-by-side, generous vertical padding (~80–100px), subtle teal-tinted background acceptable but no harsh gradients.
   - Trusted-by strip: horizontal flex row, no bullets, grayed-out company labels (#cbd5e1) that darken on hover. Eyebrow label uppercase letter-spaced.
   - Footer: full-width dark navy (#0f172a) bar with white/light-gray text and ~40–56px padding.
   - Media queries: at least one breakpoint at 900px and one at 600px adapting nav, hero, and grid layouts.
   - Hover/focus states on every interactive element.

8. REQUIRED HTML SKELETON. Copy this exact structure into your writeFile call,
   keeping every class name (.logo, .container, .nav-row, .nav-desktop,
   .header-cta, .hero-inner, .badge, .hero-title, .hero-sub, .ctas, .btn /
   .btn-primary / .btn-secondary, .hiring, .hiring-list, .footer-grid,
   .footer-brand, .footer-col, .footer-bottom) — the CSS skeleton depends on them.

   IMPORTANT: the example text below is REAL filler copy you can use as-is OR rewrite
   in your own words. Do NOT keep template placeholders visible. The runtime rejects
   HTML containing literal strings like "YOUR_HEADLINE_PART_ONE", "YOUR_BADGE_TEXT",
   "ACCENT_WORD", "YOUR_TWO_LINE_VALUE_PROP_SUBTEXT", or "YOUR_ONE_LINE_TAGLINE".

   <!DOCTYPE html>
   <html lang="en">
   <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>Scaler Clone</title>
     <link rel="preconnect" href="https://fonts.googleapis.com">
     <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
     <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
     <link rel="stylesheet" href="style.css">
   </head>
   <body>
     <header id="site-header">
       <div class="container nav-row">
         <a href="#" class="logo">Scaler</a>
         <nav class="nav-desktop">
           <ul>
             <li><a href="#programs">Programs</a></li>
             <li><a href="#courses">Courses</a></li>
             <li><a href="#resources">Resources</a></li>
             <li><a href="#business">For Business</a></li>
           </ul>
         </nav>
         <div class="header-cta">
           <a href="#login" class="login">Login</a>
           <a href="#apply" class="apply">Apply Now</a>
         </div>
       </div>
     </header>
     <main>
       <section class="hero">
         <div class="container hero-inner">
           <div class="badge"><span class="badge-dot"></span>New cohort opens soon</div>
           <h1 class="hero-title">Learn engineering <span class="highlight">live</span>, from people who ship.</h1>
           <p class="hero-sub">Weekend classes, mentorship from working engineers, and a portfolio you can defend in interviews.</p>
           <div class="ctas">
             <a href="#apply" class="btn btn-primary">Apply Now</a>
             <a href="#learn" class="btn btn-secondary">Learn More</a>
           </div>
         </div>
       </section>
       <section class="hiring">
         <div class="container">
           <p class="hiring-label">Where our alumni ship code</p>
           <ul class="hiring-list">
             <li><a href="#">Acme</a></li>
             <li><a href="#">Globex</a></li>
             <li><a href="#">Initech</a></li>
             <li><a href="#">Soylent</a></li>
             <li><a href="#">Hooli</a></li>
             <li><a href="#">Pied Piper</a></li>
           </ul>
         </div>
       </section>
     </main>
     <footer id="site-footer">
       <div class="container footer-grid">
         <div class="footer-brand">
           <a href="#" class="footer-logo">Scaler</a>
           <p class="footer-tag">Built for engineers who keep learning.</p>
         </div>
         <div class="footer-col">
           <h4>Programs</h4>
           <ul><li><a href="#">Full-stack engineering</a></li><li><a href="#">Data and ML</a></li><li><a href="#">System design</a></li><li><a href="#">Product leadership</a></li></ul>
         </div>
         <div class="footer-col">
           <h4>Company</h4>
           <ul><li><a href="#">Our story</a></li><li><a href="#">Open roles</a></li><li><a href="#">Hire from us</a></li><li><a href="#">Contact</a></li></ul>
         </div>
         <div class="footer-col">
           <h4>Resources</h4>
           <ul><li><a href="#">Engineering blog</a></li><li><a href="#">Interview toolkit</a></li><li><a href="#">Learner community</a></li><li><a href="#">Tech meetups</a></li></ul>
         </div>
       </div>
       <div class="container footer-bottom">
         <p>(c) 2026 Scaler Clone.</p>
         <ul class="footer-bottom-links"><li><a href="#">Privacy</a></li><li><a href="#">Terms</a></li><li><a href="#">Sitemap</a></li></ul>
       </div>
     </footer>
     <script src="script.js" defer></script>
   </body>
   </html>

   FORBIDDEN in HTML:
   - <button>Login</button> with no class — use <a class="login"> and <a class="apply"> in the
     header, and <a class="btn btn-primary"> / <a class="btn btn-secondary"> in the hero.
   - <img src="company1.png"> or any placeholder image src that will 404 — use plain text in <a>.
   - Skipping the .logo element. Without it the header flexbox sprawls.

9. REQUIRED CSS PASS-1 (writeFile style.css with EXACTLY this content, then appendFile the rest):

   /* Reset and tokens */
   *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
   :root {
     --bg: #ffffff; --bg-soft: #f7f8fa;
     --primary: #00A699; --primary-dark: #008C82; --primary-soft: #e6faf8;
     --ink: #0f172a; --text: #475569; --muted: #94a3b8; --rule: #e5e7eb;
     --footer-bg: #0f172a; --footer-bg-2: #1e293b;
   }
   html { scroll-behavior: smooth; }
   body { font-family: 'Inter', system-ui, sans-serif; font-size: 16px; line-height: 1.6; color: var(--text); background: var(--bg); -webkit-font-smoothing: antialiased; }
   a { color: inherit; text-decoration: none; }
   ul { list-style: none; }
   button { font: inherit; cursor: pointer; background: none; border: 0; }
   h1, h2, h3, h4 { color: var(--ink); line-height: 1.2; letter-spacing: -0.4px; }
   .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
   .btn { display: inline-flex; align-items: center; justify-content: center; padding: 13px 28px; border-radius: 8px; font-weight: 600; font-size: 1rem; border: 2px solid transparent; transition: background .2s, color .2s, border-color .2s, transform .15s; }
   .btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
   .btn-primary:hover { background: var(--primary-dark); border-color: var(--primary-dark); transform: translateY(-1px); }
   .btn-secondary { background: transparent; color: var(--primary); border-color: var(--primary); }
   .btn-secondary:hover { background: var(--primary); color: #fff; transform: translateY(-1px); }

   Then appendFile passes for header / hero / hiring / footer / responsive — match the
   class names in the HTML skeleton above. Required pass-2 (header) MUST set:
     header { position: sticky; top: 0; z-index: 100; background: #fff; border-bottom: 1px solid var(--rule); }
     .nav-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; height: 76px; }
     .logo { font-size: 1.625rem; font-weight: 700; color: var(--primary); }
     .nav-desktop { flex: 1; display: flex; justify-content: center; }
     .nav-desktop ul { display: flex; gap: 4px; }
     .nav-desktop a { padding: 8px 14px; border-radius: 6px; color: var(--ink); font-weight: 500; font-size: 0.9375rem; }
     .nav-desktop a:hover { color: var(--primary); background: var(--primary-soft); }
     .header-cta { display: flex; align-items: center; gap: 14px; }
     .header-cta .login { color: var(--text); padding: 8px 4px; }
     .header-cta .apply { background: var(--primary); color: #fff; padding: 11px 22px; border-radius: 8px; border: 2px solid var(--primary); font-weight: 600; }
     .header-cta .apply:hover { background: var(--primary-dark); border-color: var(--primary-dark); }
   Required pass-3 (hero) MUST set:
     .hero { background: linear-gradient(180deg, #fff 0%, var(--bg-soft) 100%); padding: 96px 0 104px; border-bottom: 1px solid var(--rule); }
     .hero-inner { display: flex; flex-direction: column; align-items: center; text-align: center; }
     .badge { display: inline-flex; align-items: center; gap: 8px; background: var(--primary-soft); color: var(--primary); font-size: 0.8125rem; font-weight: 600; padding: 6px 14px; border-radius: 999px; border: 1px solid #b2ede8; margin-bottom: 28px; }
     .badge-dot { width: 7px; height: 7px; background: var(--primary); border-radius: 50%; }
     .hero-title { font-size: clamp(2.25rem, 5.4vw, 4rem); font-weight: 700; line-height: 1.1; letter-spacing: -1px; max-width: 18ch; margin-bottom: 22px; }
     .hero-title .highlight { color: var(--primary); }
     .hero-sub { font-size: 1.125rem; max-width: 56ch; margin: 0 auto 36px; }
     .ctas { display: inline-flex; flex-wrap: wrap; gap: 14px; justify-content: center; }
   Required pass-5 (footer) MUST set:
     footer { background: var(--footer-bg); color: var(--muted); padding: 64px 0 0; }
     .footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 48px; padding-bottom: 48px; border-bottom: 1px solid var(--footer-bg-2); text-align: left; }
     .footer-brand .footer-logo { display: inline-block; font-size: 1.5rem; font-weight: 700; color: var(--primary); margin-bottom: 14px; }
     .footer-col h4 { color: #fff; font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 18px; }
     .footer-col ul { display: flex; flex-direction: column; gap: 12px; }
     .footer-col a { color: #64748b; font-size: 0.9rem; }
     .footer-col a:hover { color: var(--primary); }
     .footer-bottom { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; padding: 22px 24px; font-size: 0.85rem; color: #475569; }
     .footer-bottom-links { display: flex; gap: 24px; }
   Required pass-6 (responsive) MUST include @media (max-width: 900px) hiding .nav-desktop and
   .header-cta, and @media (max-width: 640px) stacking .ctas and footer-grid.

10. Never invent tools. The available tools are exactly: executeCommand, writeFile, appendFile, readFile, fetchScalerSite. If a tool name doesn't appear in that list it does not exist.

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
  if (!process.env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY in .env (copy .env.example to .env first).");
    process.exit(1);
  }

  await printBanner();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  console.log(`\x1b[90m  Model : \x1b[0m\x1b[36m${MODEL}\x1b[0m`);
  console.log(`\x1b[90m  Tip   : \x1b[0mType an instruction, or \x1b[33m'exit'\x1b[0m to quit.\n`);

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
