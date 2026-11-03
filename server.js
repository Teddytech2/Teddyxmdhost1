
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const config = require("./config");

const app = express();
const PORT = process.env.PORT || config.PORT || 3000;
const HEROKU_API = "https://api.heroku.com";

// Keep apps in a Deploying state while Heroku is building/releasing them.
const activeDeployments = new Map();
const DEPLOYMENT_TRACK_TTL = 30 * 60 * 1000;

function rememberDeployment(appName, details = {}) {
  if (!appName) return;
  const key = String(appName).toLowerCase();
  const previous = activeDeployments.get(key) || {};
  activeDeployments.set(key, {
    ...previous,
    ...details,
    startedAt: previous.startedAt || Date.now(),
    expiresAt: Date.now() + DEPLOYMENT_TRACK_TTL
  });
}

function clearDeployment(appName) {
  if (appName) activeDeployments.delete(String(appName).toLowerCase());
}

async function refreshDeployment(appName) {
  const key = String(appName || "").toLowerCase();
  const item = activeDeployments.get(key);
  if (!item) return null;

  if (Date.now() > item.expiresAt) {
    clearDeployment(key);
    return null;
  }

  try {
    if (item.setupId) {
      const setup = await heroku(`/app-setups/${encodeURIComponent(item.setupId)}`);
      const status = String(setup.status || "pending").toLowerCase();
      const buildStatus = String(setup.build?.status || "").toLowerCase();
      const failed = ["failed", "failure", "canceled", "cancelled", "errored"];
      const succeeded = ["succeeded", "success", "complete", "completed"];

      if (failed.includes(status) || failed.includes(buildStatus)) {
        clearDeployment(key);
        return null;
      }

      const updated = {
        ...item,
        setupStatus: status,
        buildStatus,
        statusCheckedAt: Date.now()
      };

      if (succeeded.includes(status)) {
        updated.completedAt = item.completedAt || Date.now();
        // Keep the Deploying state briefly while Heroku starts the first dyno.
        if (Date.now() - updated.completedAt > 5 * 60 * 1000) {
          clearDeployment(key);
          return null;
        }
      } else {
        updated.completedAt = null;
      }

      activeDeployments.set(key, updated);
    } else if (item.buildId) {
      const build = await heroku(`/apps/${encodeURIComponent(appName)}/builds/${encodeURIComponent(item.buildId)}`);
      const status = String(build.status || "pending").toLowerCase();
      if (["failed", "failure", "canceled", "cancelled", "errored"].includes(status)) {
        clearDeployment(key);
        return null;
      }
      const updated = { ...item, buildStatus: status, statusCheckedAt: Date.now() };
      if (["succeeded", "success"].includes(status)) {
        updated.completedAt = item.completedAt || Date.now();
        if (Date.now() - updated.completedAt > 5 * 60 * 1000) {
          clearDeployment(key);
          return null;
        }
      }
      activeDeployments.set(key, updated);
    }
  } catch (error) {
    // Keep showing progress during temporary Heroku status API errors.
    console.warn(`Deployment progress check failed for ${appName}:`, error.message);
  }

  return activeDeployments.get(key) || null;
}

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

app.use("/api/login", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
}));

// ADMIN AUTHENTICATION
function requireAdmin(req, res, next) {
  if (req.session?.admin === true) return next();

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

// HEROKU API CLIENT
async function heroku(pathname, options = {}) {
  if (
    !config.HEROKU_API_KEY ||
    config.HEROKU_API_KEY.includes("PASTE_YOUR")
  ) {
    const error = new Error(
      "Set HEROKU_API_KEY in config.js."
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

// GITHUB REPOSITORY
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

// LOGIN
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
    authenticated: !!req.session?.admin
  });
});

// FETCH BOT MANIFEST
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
        error: "App name must be 3–30 characters, start with a letter and end with a letter or number."
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

    if (
      typeof supplied !== "object" ||
      Array.isArray(supplied) ||
      supplied === null
    ) {
      return res.status(400).json({
        error: "Invalid environment configuration."
      });
    }

    const overrides = {};

    // Process variables declared in app.json
    for (const [key, spec] of Object.entries(manifest.env || {})) {
      const value = String(supplied[key] ?? "").trim();

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

    // SESSION_ID is accepted even if it is not in app.json
    const sessionId = String(supplied.SESSION_ID || "").trim();

    if (!sessionId) {
      return res.status(400).json({
        error: "Please enter your WhatsApp SESSION_ID before deploying."
      });
    }

    if (sessionId.length > 20000) {
      return res.status(400).json({
        error: "SESSION_ID is too long."
      });
    }

    // Always include SESSION_ID in Heroku config overrides
    overrides.SESSION_ID = sessionId;

    const setup = await heroku("/app-setups", {
      method: "POST",
      body: JSON.stringify({
        app: { name },
        source_blob: {
          url: info.tarball
        },
        overrides: {
          env: overrides
        }
      })
    });

    rememberDeployment(name, { setupId: setup.id, kind: "setup" });

    res.json({
      ok: true,
      setup
    });

  } catch (error) {
    sendError(res, error);
  }
});

// DEPLOYMENT PROGRESS
app.get("/api/setups/:id", requireAdmin, async (req, res) => {
  try {
    const setup = await heroku(
      `/app-setups/${encodeURIComponent(req.params.id)}`
    );

    let buildResult = null;

    if (
      setup.app &&
      setup.build?.id &&
      setup.build.status === "succeeded"
    ) {
      try {
        buildResult = await heroku(
          `/apps/${encodeURIComponent(setup.app.name)}/builds/${encodeURIComponent(setup.build.id)}/result`
        );
      } catch {}
    }

    if (setup.app?.name) {
      const setupStatus = String(setup.status || "pending").toLowerCase();
      const buildStatus = String(setup.build?.status || "").toLowerCase();
      const failed = ["failed", "failure", "canceled", "cancelled", "errored"];
      if (failed.includes(setupStatus) || failed.includes(buildStatus)) {
        clearDeployment(setup.app.name);
      } else {
        const current = activeDeployments.get(String(setup.app.name).toLowerCase()) || {};
        rememberDeployment(setup.app.name, {
          ...current,
          setupId: setup.id,
          kind: "setup",
          setupStatus,
          buildStatus,
          completedAt: ["succeeded", "success", "complete", "completed"].includes(setupStatus)
            ? (current.completedAt || Date.now())
            : null
        });
      }
    }

    res.json({ setup, buildResult });
  } catch (error) {
    sendError(res, error);
  }
});

// LIVE HEROKU BUILD OUTPUT
// Heroku provides a separate output_stream_url for each app setup build.
// Proxy it through the authenticated dashboard so the API key and stream URL
// are never exposed to the browser.
app.get("/api/setups/:id/build-logs", requireAdmin, async (req, res) => {
  let controller;

  try {
    const setup = await heroku(
      `/app-setups/${encodeURIComponent(req.params.id)}`
    );

    const streamUrl = setup.build?.output_stream_url;
    if (!streamUrl) {
      return res.status(202).type("text/plain").send(
        "Waiting for Heroku to start the build and publish its logs…\n"
      );
    }

    const parsed = new URL(streamUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "build-output.heroku.com"
    ) {
      return res.status(502).json({
        error: "Heroku returned an unexpected build log address."
      });
    }

    controller = new AbortController();
    res.on("close", () => controller.abort());

    const upstream = await fetch(parsed.toString(), {
      headers: { Accept: "text/plain" },
      signal: controller.signal
    });

    if (!upstream.ok) {
      throw new Error(`Heroku build log stream returned ${upstream.status}.`);
    }

    res.status(200);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (!upstream.body) return res.end();

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (res.destroyed) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise(resolve => res.once("drain", resolve));
      }
    }
    if (!res.destroyed) res.end();
  } catch (error) {
    if (error.name === "AbortError" || res.destroyed) return;
    if (res.headersSent) return res.end();
    sendError(res, error);
  }
});

// LIST APPS WITH LIVE DYNO STATUS
app.get("/api/apps", requireAdmin, async (req, res) => {
  try {
    const apps = await heroku("/apps");

    const results = await Promise.all(
      apps.map(async (app) => {
        try {
          const deployment = await refreshDeployment(app.name);
          const [dynos, formation] = await Promise.all([
            heroku(`/apps/${encodeURIComponent(app.name)}/dynos`),
            heroku(`/apps/${encodeURIComponent(app.name)}/formation`)
          ]);

          const webFormation = formation.find(
            process => process.type === "web"
          );

          const webDynos = dynos.filter(
            dyno => dyno.type === "web"
          );

          const running = webDynos.filter(
            dyno => dyno.state === "up"
          ).length;

          const starting = webDynos.some(
            dyno => ["starting", "restarting"].includes(dyno.state)
          );

          const crashed = webDynos.some(
            dyno => dyno.state === "crashed"
          );

          const desired = webFormation
            ? Number(webFormation.quantity || 0)
            : 0;

          let status = "offline";

          if (app.maintenance) {
            status = "maintenance";
          } else if (running > 0) {
            status = "running";
          } else if (starting) {
            status = "starting";
          } else if (crashed) {
            status = "offline";
          } else if (desired === 0) {
            status = "scaled-down";
          }

          if (deployment && running === 0 && !crashed && !app.maintenance) {
            const setupStatus = String(deployment.setupStatus || "pending").toLowerCase();
            const buildStatus = String(deployment.buildStatus || "").toLowerCase();
            const buildingStates = ["pending", "provisioning", "importing", "building"];

            if (
              buildingStates.includes(setupStatus) ||
              ["pending", "running"].includes(buildStatus)
            ) {
              status = "building";
            } else {
              status = "deploying";
            }
          } else if (running > 0 || crashed) {
            // A live dyno means deployment completed; a crashed dyno is Offline.
            clearDeployment(app.name);
          }

          return {
            id: app.id,
            name: app.name,
            web_url: app.web_url,
            created_at: app.created_at,
            updated_at: app.updated_at,
            region: app.region?.name || null,
            stack: app.stack?.name || null,
            maintenance: app.maintenance,
            status,
            status_reason: crashed ? "The web dyno crashed." : null,
            deployment_started_at: deployment?.startedAt || null,
            running_dynos: running,
            total_web_dynos: webDynos.length,
            desired_web_dynos: desired
          };
        } catch (error) {
          console.error(
            `Status check failed for ${app.name}:`,
            error.message
          );

          return {
            id: app.id,
            name: app.name,
            web_url: app.web_url,
            maintenance: app.maintenance,
            status: "unknown",
            error: error.message
          };
        }
      })
    );

    res.set("Cache-Control", "no-store");
    res.json(results);
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

    rememberDeployment(name, { buildId: build.id, kind: "build" });
    res.json({ ok: true, build });
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

    if (!response.ok) {
      throw new Error(`Log retrieval failed: ${response.status}`);
    }

    const logs = await response.text();
    res.type("text/plain").send(logs);
  } catch (error) {
    sendError(res, error);
  }
});

// ANDROID APK DOWNLOAD
// Do not let the single-page-app fallback return index.html for a missing APK.
app.get("/downloads/TEDDY-XMD.apk", (req, res) => {
  const apkPath = path.join(__dirname, "public", "downloads", "TEDDY-XMD.apk");

  if (!fs.existsSync(apkPath)) {
    return res.status(404).type("text/plain").send(
      "TEDDY-XMD Android APK is not available yet. Run the GitHub Actions workflow: Build TEDDY-XMD Android APK, then redeploy this dashboard."
    );
  }

  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Content-Disposition", 'attachment; filename="TEDDY-XMD.apk"');
  return res.sendFile(apkPath);
});

// FRONTEND
app.use(express.static(path.join(__dirname, "public")));

// EXPRESS 5 CATCH-ALL
app.get("/{*splat}", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

app.listen(PORT, () => {
  console.log(`TEDDY-XMD DEPLOYER listening on ${PORT}`);
});
