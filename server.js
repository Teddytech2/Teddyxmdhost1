
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("crypto");
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
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.use(
  "/api/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false
  })
);

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) {
    return next();
  }

  return res.status(401).json({
    error: "Please log in as administrator."
  });
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));

  return aa.length === bb.length &&
    crypto.timingSafeEqual(aa, bb);
}

async function heroku(pathname, options = {}) {
  if (
    !config.HEROKU_API_KEY ||
    config.HEROKU_API_KEY.includes("PASTE_YOUR")
  ) {
    const error = new Error(
      "Set HEROKU_API_KEY in config.js before using Heroku features."
    );

    error.status = 503;
    throw error;
  }

  const response = await fetch(`${HEROKU_API}${pathname}`, {
    ...options,
    headers: {
      ...HEROKU_HEADERS,
      ...(options.headers || {})
    }
  });

  const raw = await response.text();

  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: raw };
  }

  if (!response.ok) {
    const error = new Error(
      data.message ||
      data.error ||
      `Heroku API returned ${response.status}`
    );

    error.status = response.status;
    error.details = data;

    throw error;
  }

  return data;
}

function sendError(res, error) {
  console.error("API error:", error.message);

  res.status(
    error.status && error.status < 500
      ? error.status
      : 500
  ).json({
    error: error.message || "Unexpected server error",
    details: error.details &&
      (error.details.message || error.details.id)
  });
}

function repoInfo() {
  const owner = config.GITHUB.OWNER;
  const repo = config.GITHUB.REPO;
  const branch = config.GITHUB.BRANCH || "main";

  return {
    owner,
    repo,
    branch,

    tarball:
      `https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${encodeURIComponent(branch)}`,

    rawManifest:
      `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/app.json`
  };
}

// ADMIN LOGIN
app.post("/api/login", (req, res) => {
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();

  const password = String(req.body.password || "");

  if (
    !safeEqual(email, String(config.ADMIN.EMAIL).toLowerCase()) ||
    !safeEqual(password, config.ADMIN.PASSWORD)
  ) {
    return res.status(401).json({
      error: "Incorrect email or password."
    });
  }

  req.session.regenerate(error => {
    if (error) {
      return res.status(500).json({
        error: "Could not create admin session."
      });
    }

    req.session.admin = true;

    req.session.save(saveError => {
      if (saveError) {
        return res.status(500).json({
          error: "Could not save admin session."
        });
      }

      res.json({ ok: true });
    });
  });
});

app.post("/api/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  res.json({
    authenticated: !!(
      req.session &&
      req.session.admin
    )
  });
});

// GITHUB MANIFEST
app.get("/api/manifest", requireAdmin, async (req, res) => {
  try {
    const info = repoInfo();

    const response = await fetch(info.rawManifest, {
      headers: {
        "User-Agent": "TEDDY-XMD-DEPLOYER"
      }
    });

    if (!response.ok) {
      throw new Error(
        `Could not load app.json from GitHub (${response.status}).`
      );
    }

    const manifest = await response.json();
    const env = {};

    for (const [key, spec] of Object.entries(manifest.env || {})) {
      env[key] = {
        description:
          typeof spec === "string"
            ? spec
            : spec.description || "",

        required:
          typeof spec === "object"
            ? spec.required !== false
            : false,

        value:
          typeof spec === "object" &&
          typeof spec.value === "string"
            ? spec.value
            : ""
      };
    }

    res.json({
      repository: `https://github.com/${info.owner}/${info.repo}`,
      branch: info.branch,

      manifest: {
        name: manifest.name || info.repo,
        description: manifest.description || "",
        env
      }
    });
  } catch (error) {
    sendError(res, error);
  }
});

// DEPLOY NEW BOT
app.post("/api/deploy", requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "")
      .trim()
      .toLowerCase();

    if (!/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(name)) {
      return res.status(400).json({
        error: "App name must be 3–30 characters and contain only lowercase letters, numbers or hyphens."
      });
    }

    const info = repoInfo();

    const manifestResponse = await fetch(info.rawManifest, {
      headers: {
        "User-Agent": "TEDDY-XMD-DEPLOYER"
      }
    });

    if (!manifestResponse.ok) {
      throw new Error(
        "Could not read app.json from the configured GitHub repository."
      );
    }

    const manifest = await manifestResponse.json();
    const supplied = req.body.env || {};
    const overrides = {};

    for (const [key, spec] of Object.entries(manifest.env || {})) {
      const value =
        supplied[key] !== undefined
          ? String(supplied[key])
          : "";

      const required =
        typeof spec === "object" &&
        spec.required === true;

      if (
        required &&
        !value &&
        !(spec.value || spec.generator)
      ) {
        return res.status(400).json({
          error: `Missing required configuration: ${key}`
        });
      }

      if (value) {
        overrides[key] = value;
      }
    }

    const setup = await heroku("/app-setups", {
      method: "POST",

      body: JSON.stringify({
        app: { name },

        source_blob: {
          url: info.tarball
        },

        ...(Object.keys(overrides).length
          ? { overrides: { env: overrides } }
          : {})
      })
    });

    res.json({
      ok: true,
      setup
    });
  } catch (error) {
    sendError(res, error);
  }
});

// DEPLOYMENT STATUS
app.get("/api/setups/:id", requireAdmin, async (req, res) => {
  try {
    const setup = await heroku(
      `/app-setups/${encodeURIComponent(req.params.id)}`
    );

    let buildResult = null;

    if (
      setup.app &&
      setup.build &&
      setup.build.id &&
      setup.build.status === "succeeded"
    ) {
      try {
        buildResult = await heroku(
          `/apps/${encodeURIComponent(setup.app.name)}/builds/${encodeURIComponent(setup.build.id)}/result`
        );
      } catch {}
    }

    res.json({
      setup,
      buildResult
    });
  } catch (error) {
    sendError(res, error);
  }
});

// LIST APPS
app.get("/api/apps", requireAdmin, async (req, res) => {
  try {
    const apps = await heroku("/apps");

    res.json(
      apps.map(app => ({
        id: app.id,
        name: app.name,
        web_url: app.web_url,
        created_at: app.created_at,
        updated_at: app.updated_at,
        region: app.region && app.region.name,
        stack: app.stack && app.stack.name,
        maintenance: app.maintenance
      }))
    );
  } catch (error) {
    sendError(res, error);
  }
});

// APP DETAILS
app.get("/api/apps/:name", requireAdmin, async (req, res) => {
  try {
    const name = encodeURIComponent(req.params.name);

    const [details, formation, configVars] = await Promise.all([
      heroku(`/apps/${name}`),
      heroku(`/apps/${name}/formation`),
      heroku(`/apps/${name}/config-vars`)
    ]);

    res.json({
      details,
      formation,
      configVars
    });
  } catch (error) {
    sendError(res, error);
  }
});

// RESTART APP
app.post("/api/apps/:name/restart", requireAdmin, async (req, res) => {
  try {
    const name = req.params.name;

    if ((config.PROTECTED_APP_NAMES || []).includes(name)) {
      return res.status(403).json({
        error: "This app is protected."
      });
    }

    await heroku(
      `/apps/${encodeURIComponent(name)}/dynos`,
      { method: "DELETE" }
    );

    res.json({
      ok: true,
      message: "Restart requested."
    });
  } catch (error) {
    sendError(res, error);
  }
});

// REDEPLOY APP
app.post("/api/apps/:name/redeploy", requireAdmin, async (req, res) => {
  try {
    const name = req.params.name;

    if ((config.PROTECTED_APP_NAMES || []).includes(name)) {
      return res.status(403).json({
        error: "This app is protected."
      });
    }

    const info = repoInfo();

    const build = await heroku(
      `/apps/${encodeURIComponent(name)}/builds`,
      {
        method: "POST",

        body: JSON.stringify({
          source_blob: {
            url: info.tarball,
            version_description:
              `Deploy ${info.owner}/${info.repo}@${info.branch}`
          }
        })
      }
    );

    res.json({
      ok: true,
      build
    });
  } catch (error) {
    sendError(res, error);
  }
});

// DELETE APP
app.delete("/api/apps/:name", requireAdmin, async (req, res) => {
  try {
    const name = req.params.name;

    if ((config.PROTECTED_APP_NAMES || []).includes(name)) {
      return res.status(403).json({
        error: "This app is protected."
      });
    }

    if (String(req.body.confirm || "") !== name) {
      return res.status(400).json({
        error: "Confirmation does not match app name."
      });
    }

    await heroku(
      `/apps/${encodeURIComponent(name)}`,
      { method: "DELETE" }
    );

    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

// APP LOGS
app.get("/api/apps/:name/logs", requireAdmin, async (req, res) => {
  try {
    const name = encodeURIComponent(req.params.name);

    const logSession = await heroku(
      `/apps/${name}/log-sessions`,
      {
        method: "POST",

        body: JSON.stringify({
          lines: 200,
          source: "app",
          dyno: null,
          tail: false
        })
      }
    );

    if (!logSession.logplex_url) {
      return res.status(502).json({
        error: "Heroku did not return a log URL."
      });
    }

    const response = await fetch(logSession.logplex_url, {
      headers: {
        Accept: "text/plain"
      }
    });

    const logs = await response.text();

    res.type("text/plain").send(logs);
  } catch (error) {
    sendError(res, error);
  }
});

// FRONTEND
app.use(express.static(path.join(__dirname, "public")));

// EXPRESS 5 CATCH-ALL ROUTE
app.get("/{*splat}", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// START SERVER
app.listen(PORT, () => {
  console.log(
    `TEDDY-XMD DEPLOYER listening on ${PORT}`
  );
});
