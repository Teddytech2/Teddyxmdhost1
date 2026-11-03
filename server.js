const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const config = require("./config");

const app = express();
const PORT = process.env.PORT || config.PORT || 3000;
const HEROKU_API = "https://api.heroku.com";
const HEROKU_HEADERS = {
  Authorization: `Bearer ${config.HEROKU_API_KEY}`,
  Accept: "application/vnd.heroku+json; version=3",
  "Content-Type": "application/json"
};

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "teddy_deployer_sid",
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));
app.use("/api/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  return res.status(401).json({ error: "Please log in as administrator." });
}
function safeEqual(a, b) {
  const crypto = require("crypto");
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
async function heroku(pathname, options = {}) {
  if (!config.HEROKU_API_KEY || config.HEROKU_API_KEY.includes("PASTE_YOUR")) {
    const e = new Error("Set HEROKU_API_KEY in config.js before using Heroku features.");
    e.status = 503; throw e;
  }
  const response = await fetch(`${HEROKU_API}${pathname}`, {
    ...options,
    headers: { ...HEROKU_HEADERS, ...(options.headers || {}) }
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const e = new Error(data.message || data.error || `Heroku API returned ${response.status}`);
    e.status = response.status; e.details = data; throw e;
  }
  return data;
}
function sendError(res, err) {
  console.error("API error:", err.message);
  res.status(err.status && err.status < 500 ? err.status : 500).json({
    error: err.message || "Unexpected server error",
    details: err.details && (err.details.message || err.details.id)
  });
}
function repoInfo() {
  const owner = config.GITHUB.OWNER;
  const repo = config.GITHUB.REPO;
  const branch = config.GITHUB.BRANCH || "main";
  return { owner, repo, branch, tarball: `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${encodeURIComponent(branch)}`,
    rawManifest: `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/app.json` };
}

app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!safeEqual(email, String(config.ADMIN.EMAIL).toLowerCase()) || !safeEqual(password, config.ADMIN.PASSWORD)) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not create admin session." });
    req.session.admin = true;
    req.session.save(e => e ? res.status(500).json({ error: "Could not save admin session." }) : res.json({ ok: true }));
  });
});
app.post("/api/logout", requireAdmin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", (req, res) => res.json({ authenticated: !!(req.session && req.session.admin) }));

app.get("/api/manifest", requireAdmin, async (req, res) => {
  try {
    const info = repoInfo();
    const r = await fetch(info.rawManifest, { headers: { "User-Agent": "TEDDY-XMD-DEPLOYER" } });
    if (!r.ok) throw new Error(`Could not load app.json from GitHub (${r.status}). Check the repository branch and manifest.`);
    const manifest = await r.json();
    const env = {};
    for (const [key, spec] of Object.entries(manifest.env || {})) {
      env[key] = { description: typeof spec === "string" ? spec : (spec.description || ""), required: typeof spec === "object" ? spec.required !== false : false,
        value: typeof spec === "object" && typeof spec.value === "string" ? spec.value : "" };
    }
    res.json({ repository: `https://github.com/${info.owner}/${info.repo}`, branch: info.branch, manifest: {
      name: manifest.name || info.repo, description: manifest.description || "", env
    }});
  } catch (e) { sendError(res, e); }
});

app.post("/api/deploy", requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(name)) return res.status(400).json({ error: "App name must be 3–30 characters, start with a letter, end with a letter or number, and contain only lowercase letters, numbers or hyphens." });
    const info = repoInfo();
    const mr = await fetch(info.rawManifest, { headers: { "User-Agent": "TEDDY-XMD-DEPLOYER" } });
    if (!mr.ok) throw new Error("Could not read app.json from the configured GitHub repository.");
    const manifest = await mr.json();
    const supplied = req.body.env || {};
    const overrides = {};
    for (const [key, spec] of Object.entries(manifest.env || {})) {
      const value = supplied[key] !== undefined ? String(supplied[key]) : "";
      const required = typeof spec === "object" && spec.required === true;
      if (required && !value && !(spec.value || spec.generator)) return res.status(400).json({ error: `Missing required configuration: ${key}` });
      if (value) overrides[key] = value;
    }
    const setup = await heroku("/app-setups", { method: "POST", body: JSON.stringify({
      app: { name },
      source_blob: { url: info.tarball },
      ...(Object.keys(overrides).length ? { overrides: { env: overrides } } : {})
    })});
    res.json({ ok: true, setup });
  } catch (e) { sendError(res, e); }
});

app.get("/api/setups/:id", requireAdmin, async (req, res) => {
  try {
    const setup = await heroku(`/app-setups/${encodeURIComponent(req.params.id)}`);
    let buildResult = null;
    if (setup.app && setup.build && setup.build.id && setup.build.status === "succeeded") {
      try { buildResult = await heroku(`/apps/${encodeURIComponent(setup.app.name)}/builds/${encodeURIComponent(setup.build.id)}/result`); } catch {}
    }
    res.json({ setup, buildResult });
  } catch (e) { sendError(res, e); }
});

app.get("/api/apps", requireAdmin, async (req, res) => {
  try {
    const apps = await heroku("/apps");
    res.json(apps.map(a => ({ id: a.id, name: a.name, web_url: a.web_url, created_at: a.created_at, updated_at: a.updated_at, region: a.region && a.region.name, stack: a.stack && a.stack.name, maintenance: a.maintenance })));
  } catch (e) { sendError(res, e); }
});
app.get("/api/apps/:name", requireAdmin, async (req, res) => {
  try {
    const name = encodeURIComponent(req.params.name);
    const [details, formation, configVars] = await Promise.all([
      heroku(`/apps/${name}`), heroku(`/apps/${name}/formation`), heroku(`/apps/${name}/config-vars`)
    ]);
    res.json({ details, formation, configVars });
  } catch (e) { sendError(res, e); }
});
app.post("/api/apps/:name/restart", requireAdmin, async (req, res) => {
  try {
    const name = req.params.name;
    if ((config.PROTECTED_APP_NAMES || []).includes(name)) return res.status(403).json({ error: "This app is protected." });
    await heroku(`/apps/${encodeURIComponent(name)}/dynos`, { method: "DELETE" });
    res.json({ ok: true, message: "Restart requested." });
  } catch (e) { sendError(res, e); }
});
app.post("/api/apps/:name/redeploy", requireAdmin, async (req, res) => {
  try {
    const name = req.params.name;
    if ((config.PROTECTED_APP_NAMES || []).includes(name)) return res.status(403).json({ error: "This app is protected." });
    const info = repoInfo();
    const build = await heroku(`/apps/${encodeURIComponent(name)}/builds`, { method: "POST", body: JSON.stringify({ source_blob: { url: info.tarball, version_description: `Deploy ${info.owner}/${info.repo}@${info.branch}` } }) });
    res.json({ ok: true, build });
  } catch (e) { sendError(res, e); }
});
app.delete("/api/apps/:name", requireAdmin, async (req, res) => {
  try {
    const name = req.params.name;
    if ((config.PROTECTED_APP_NAMES || []).includes(name)) return res.status(403).json({ error: "This app is protected." });
    if (String(req.body.confirm || "") !== name) return res.status(400).json({ error: "Confirmation does not match app name." });
    await heroku(`/apps/${encodeURIComponent(name)}`, { method: "DELETE" });
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});
app.get("/api/apps/:name/logs", requireAdmin, async (req, res) => {
  try {
    const name = encodeURIComponent(req.params.name);
    const session = await heroku(`/apps/${name}/log-sessions`, { method: "POST", body: JSON.stringify({ lines: 200, source: "app", dyno: null, tail: false }) });
    if (!session.logplex_url) return res.status(502).json({ error: "Heroku did not return a log URL." });
    // Logplex URLs are temporary bearer URLs; retrieve them only on the server.
    const r = await fetch(session.logplex_url, { headers: { Accept: "text/plain" } });
    const logs = await r.text();
    res.type("text/plain").send(logs);
  } catch (e) { sendError(res, e); }
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`TEDDY-XMD DEPLOYER listening on ${PORT}`));
