const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || config.PORT || 3000;
const HEROKU_API = 'https://api.heroku.com';
const PAYSTACK_API = 'https://api.paystack.co';
const DEPLOY_COST = Number(config.DEPLOY_COST_COINS || 10);
const KES_PER_10_COINS = Number(config.KES_PER_10_COINS || 50);
const USD_PER_10_COINS = Number(config.USD_PER_10_COINS || 0.4);
const USD_MINIMUM = Number(config.PAYSTACK_USD_MINIMUM || 2);

mongoose.set('strictQuery', true);

// ----------------------------- DATABASE MODELS -----------------------------
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  coins: { type: Number, default: 0, min: 0 },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const deploymentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  appName: { type: String, required: true, unique: true, lowercase: true, trim: true },
  botName: { type: String, required: true },
  repoUrl: { type: String, required: true },
  repoOwner: String,
  repoName: String,
  branch: { type: String, default: 'main' },
  setupId: String,
  buildId: String,
  status: { type: String, default: 'queued' },
  statusMessage: String,
  coinsCharged: { type: Number, default: DEPLOY_COST },
  refunded: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  deletedAt: Date
}, { versionKey: false });

const paymentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reference: { type: String, required: true, unique: true },
  coins: { type: Number, required: true },
  amountMinor: { type: Number, required: true },
  currency: { type: String, enum: ['KES', 'USD'], required: true },
  status: { type: String, default: 'pending' },
  credited: { type: Boolean, default: false },
  authorizationUrl: String,
  createdAt: { type: Date, default: Date.now },
  paidAt: Date
}, { versionKey: false });

const walletTransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, required: true },
  delta: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  reference: { type: String, default: null },
  description: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const User = mongoose.model('User', userSchema);
const Deployment = mongoose.model('Deployment', deploymentSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);

// ----------------------------- MIDDLEWARE ----------------------------------
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb', verify: (req, res, buffer) => { if (req.originalUrl.startsWith('/api/payments/webhook')) req.rawBody = Buffer.from(buffer); } }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  name: 'teddy_deployer_sid',
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: config.MONGODB_URI ? MongoStore.create({
    mongoUrl: config.MONGODB_URI,
    collectionName: 'sessions',
    ttl: 8 * 60 * 60
  }) : undefined,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: (config.NODE_ENV || process.env.NODE_ENV) === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false });
app.use(['/api/login', '/api/register'], authLimiter);
app.use('/api/payments/initialize', rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }));

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function requireAuth(req, res, next) {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Please sign in to continue.' });
    const user = await User.findById(req.session.userId).select('-passwordHash');
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Your account session has expired. Please sign in again.' });
    }
    req.user = user;
    next();
  } catch (error) { next(error); }
}

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Administrator access required.' });
}

function sendError(res, error) {
  console.error('API error:', error.message);
  const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
  res.status(status).json({ error: error.message || 'Unexpected server error' });
}

// ----------------------------- PROVIDER CLIENTS ----------------------------
const HEROKU_HEADERS = {
  Authorization: `Bearer ${config.HEROKU_API_KEY}`,
  Accept: 'application/vnd.heroku+json; version=3',
  'Content-Type': 'application/json'
};

async function heroku(pathname, options = {}) {
  if (!config.HEROKU_API_KEY || String(config.HEROKU_API_KEY).includes('PASTE_YOUR')) {
    const error = new Error('Set HEROKU_API_KEY in your Heroku Config Vars.'); error.status = 503; throw error;
  }
  const response = await fetch(`${HEROKU_API}${pathname}`, {
    ...options,
    headers: { ...HEROKU_HEADERS, ...(options.headers || {}) }
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const error = new Error(data.message || data.error || `Heroku API returned ${response.status}`);
    error.status = response.status; throw error;
  }
  return data;
}

function getPublicBase(req) {
  if (config.PUBLIC_URL) return String(config.PUBLIC_URL).replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function parseGithubRepo(value) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); } catch { throw Object.assign(new Error('Enter a valid public GitHub repository URL.'), { status: 400 }); }
  if (parsed.hostname.toLowerCase() !== 'github.com' || !['https:', 'http:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Only public GitHub repository URLs are supported.'), { status: 400 });
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw Object.assign(new Error('GitHub URL must look like https://github.com/owner/repository.'), { status: 400 });
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
    throw Object.assign(new Error('The GitHub repository URL is not valid.'), { status: 400 });
  }
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

function repoSource(repo, branch) {
  const safeBranch = String(branch || 'main').trim();
  if (!safeBranch || safeBranch.length > 200 || safeBranch.includes('..')) {
    throw Object.assign(new Error('Enter a valid Git branch name.'), { status: 400 });
  }
  return {
    owner: repo.owner,
    repo: repo.repo,
    branch: safeBranch,
    tarball: `https://codeload.github.com/${repo.owner}/${repo.repo}/tar.gz/refs/heads/${encodeURIComponent(safeBranch)}`,
    rawManifest: `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${encodeURIComponent(safeBranch)}/app.json`
  };
}


function normalizeHerokuAppName(value) {
  return String(value || '').trim().toLowerCase();
}

function validateHerokuAppName(name) {
  return /^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(name);
}

async function herokuAppNameAvailable(name) {
  try {
    await heroku(`/apps/${encodeURIComponent(name)}`);
    return false;
  } catch (error) {
    if (error.status === 404) return true;
    throw error;
  }
}

function normalizeAppPrefix(value) {
  let prefix = String(value || config.DEFAULT_HEROKU_APP_PREFIX || 'teddyxhost').trim().toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  if (!prefix || !/^[a-z]/.test(prefix)) prefix = 'teddyxhost';
  return prefix.slice(0, 20);
}

async function getManifest(repoUrl, branch) {
  const repo = parseGithubRepo(repoUrl);
  const info = repoSource(repo, branch);
  const response = await fetch(info.rawManifest, { headers: { 'User-Agent': 'TEDDY-TECH-BOT-DEPLOYER' } });
  if (!response.ok) {
    const error = new Error(response.status === 404 ? 'This repository does not contain app.json on the selected branch.' : `GitHub could not load app.json (${response.status}).`);
    error.status = response.status === 404 ? 400 : 502; throw error;
  }
  let manifest;
  try { manifest = await response.json(); } catch { throw Object.assign(new Error('The repository app.json is not valid JSON.'), { status: 400 }); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw Object.assign(new Error('The repository app.json is invalid.'), { status: 400 });
  const env = {};
  for (const [key, spec] of Object.entries(manifest.env || {})) {
    env[key] = {
      description: typeof spec === 'string' ? spec : (spec?.description || ''),
      required: typeof spec === 'object' && spec !== null ? spec.required === true : false,
      value: typeof spec === 'object' && spec !== null && typeof spec.value === 'string' ? spec.value : '',
      generator: !!(typeof spec === 'object' && spec?.generator)
    };
  }
  return { info, manifest: { name: manifest.name || repo.repo, description: manifest.description || '', env } };
}

async function paystackRequest(pathname, options = {}) {
  if (!config.PAYSTACK_SECRET_KEY || String(config.PAYSTACK_SECRET_KEY).includes('PASTE_YOUR')) {
    const error = new Error('Paystack is not configured yet. Add PAYSTACK_SECRET_KEY to Heroku Config Vars.'); error.status = 503; throw error;
  }
  const response = await fetch(`${PAYSTACK_API}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.status === false) {
    const error = new Error(data.message || `Paystack returned ${response.status}`); error.status = response.status || 502; throw error;
  }
  return data.data;
}

// ----------------------------- WALLET / PAYMENTS ---------------------------
async function addWalletCredit(paymentId, paystackData) {
  const payment = await Payment.findById(paymentId);
  if (!payment || payment.credited) return false;
  if (paystackData.status !== 'success') throw Object.assign(new Error('Payment has not been completed.'), { status: 400 });
  if (Number(paystackData.amount) !== Number(payment.amountMinor) || String(paystackData.currency).toUpperCase() !== payment.currency) {
    throw Object.assign(new Error('Payment amount or currency does not match the pending order.'), { status: 400 });
  }
  const metadataUserId = paystackData.metadata?.user_id;
  const user = await User.findById(payment.userId);
  if (!user || (metadataUserId && String(metadataUserId) !== String(payment.userId))) throw Object.assign(new Error('Payment metadata does not match this account.'), { status: 400 });

  const mongoSession = await mongoose.startSession();
  let credited = false;
  try {
    await mongoSession.withTransaction(async () => {
      const current = await Payment.findOne({ _id: payment._id, credited: false, status: 'pending' }).session(mongoSession);
      if (!current) return;
      const updatedUser = await User.findByIdAndUpdate(current.userId, { $inc: { coins: current.coins } }, { new: true, session: mongoSession });
      if (!updatedUser) throw new Error('Wallet account not found.');
      current.status = 'success'; current.credited = true; current.paidAt = new Date();
      await current.save({ session: mongoSession });
      await WalletTransaction.create([{
        userId: current.userId, type: 'purchase', delta: current.coins,
        balanceAfter: updatedUser.coins, reference: current.reference,
        description: `Purchased ${current.coins} Teddy Coins through Paystack (${current.currency})`
      }], { session: mongoSession });
      credited = true;
    });
  } finally { await mongoSession.endSession(); }
  return credited;
}

async function verifyPaystackReference(reference) {
  const payment = await Payment.findOne({ reference });
  if (!payment) throw Object.assign(new Error('Payment reference was not found.'), { status: 404 });
  if (payment.credited) return payment;
  const data = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
  if (data.status !== 'success') { payment.status = String(data.status || 'failed'); await payment.save(); throw Object.assign(new Error('Paystack payment was not successful.'), { status: 400 }); }
  await addWalletCredit(payment._id, data);
  return Payment.findById(payment._id);
}

async function chargeCoins(userId, amount, type, description, reference) {
  const mongoSession = await mongoose.startSession();
  let result;
  try {
    await mongoSession.withTransaction(async () => {
      const user = await User.findOneAndUpdate(
        { _id: userId, coins: { $gte: amount } },
        { $inc: { coins: -amount } },
        { new: true, session: mongoSession }
      );
      if (!user) throw Object.assign(new Error(`You need ${amount} coins to deploy. Please top up your wallet.`), { status: 402 });
      await WalletTransaction.create([{
        userId, type, delta: -amount, balanceAfter: user.coins, reference,
        description
      }], { session: mongoSession });
      result = user.coins;
    });
  } finally { await mongoSession.endSession(); }
  return result;
}

async function refundDeployment(deployment, reason) {
  if (!deployment || deployment.refunded) return false;
  const mongoSession = await mongoose.startSession();
  let refunded = false;
  try {
    await mongoSession.withTransaction(async () => {
      const current = await Deployment.findOne({ _id: deployment._id, refunded: false }).session(mongoSession);
      if (!current) return;
      const user = await User.findByIdAndUpdate(current.userId, { $inc: { coins: current.coinsCharged || DEPLOY_COST } }, { new: true, session: mongoSession });
      if (!user) throw new Error('Cannot refund deployment: user wallet is missing.');
      current.refunded = true; current.status = 'failed'; current.statusMessage = reason || 'Deployment failed; coins refunded.'; current.updatedAt = new Date();
      await current.save({ session: mongoSession });
      await WalletTransaction.create([{
        userId: current.userId, type: 'deployment_refund', delta: current.coinsCharged || DEPLOY_COST,
        balanceAfter: user.coins, reference: current.appName,
        description: `Refund for failed deployment ${current.appName}: ${reason || 'deployment failed'}`
      }], { session: mongoSession });
      refunded = true;
    });
  } finally { await mongoSession.endSession(); }
  return refunded;
}

// ----------------------------- AUTH ROUTES ---------------------------------
// Public, non-secret settings used by the website UI. Never expose API keys here.
app.get('/api/public-config', (req, res) => {
  const supportNumber = String(config.SUPPORT_WHATSAPP || '').replace(/\D/g, '');
  res.set('Cache-Control', 'no-store');
  res.json({ supportWhatsApp: supportNumber });
});

app.post('/api/register', asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Enter your name (2–80 characters).' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must contain at least 8 characters.' });
  if (await User.exists({ email })) return res.status(409).json({ error: 'An account with this email already exists.' });
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, passwordHash, role: 'user', coins: 0 });
  req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: 'Could not start your account session.' });
    req.session.userId = String(user._id);
    req.session.save(saveError => {
      if (saveError) return res.status(500).json({ error: 'Account created, but sign-in failed. Please log in.' });
      res.status(201).json({ ok: true, user: { id: user._id, name: user.name, email: user.email, role: user.role, coins: user.coins } });
    });
  });
}));

app.post('/api/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Incorrect email or password.' });
  req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: 'Could not create your session.' });
    req.session.userId = String(user._id);
    req.session.save(saveError => {
      if (saveError) return res.status(500).json({ error: 'Could not save your session.' });
      res.json({ ok: true, user: { id: user._id, name: user.name, email: user.email, role: user.role, coins: user.coins } });
    });
  });
}));

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', asyncRoute(async (req, res) => {
  if (!req.session?.userId) return res.json({ authenticated: false });
  const user = await User.findById(req.session.userId).select('-passwordHash');
  if (!user) return res.json({ authenticated: false });
  res.set('Cache-Control', 'no-store');
  res.json({ authenticated: true, user: { id: user._id, name: user.name, email: user.email, role: user.role, coins: user.coins } });
}));

// ----------------------------- CATALOGUE / MANIFEST ------------------------
app.get('/api/catalogue', requireAuth, (req, res) => {
  res.json({
    deploymentCost: DEPLOY_COST,
    bots: [
      { id: 'teddy-xmd-ultra', name: 'TEDDY-XMD ULTRA', description: 'Teddy Tech WhatsApp automation bot' },
      { id: 'june-ultra', name: 'JUNE ULTRA', description: 'Deploy a JUNE ULTRA repository' },
      { id: 'wolfbot', name: 'WOLFBOT', description: 'Deploy a WOLFBOT repository' },
      { id: 'cypherx', name: 'CYPHERX BOT', description: 'Deploy a CYPHERX repository' },
      { id: 'custom', name: 'CUSTOM GITHUB BOT', description: 'Any public GitHub repository containing app.json' }
    ]
  });
});

app.get('/api/manifest', requireAuth, asyncRoute(async (req, res) => {
  const repoUrl = String(req.query.repoUrl || '').trim();
  const branch = String(req.query.branch || 'main').trim();
  if (!repoUrl) return res.status(400).json({ error: 'Enter a GitHub repository URL first.' });
  const data = await getManifest(repoUrl, branch);
  res.json({ repository: data.info.url, branch: data.info.branch, manifest: data.manifest });
}));


// ------------------------- HEROKU APP NAME TOOLS ---------------------------
// Heroku remains the final arbiter: names can be claimed after a preflight check.
app.get('/api/app-name/suggest', requireAuth, asyncRoute(async (req, res) => {
  const prefix = normalizeAppPrefix(req.query.prefix);
  for (let attempt = 0; attempt < 12; attempt++) {
    const suffix = crypto.randomBytes(3).toString('hex');
    const name = `${prefix}-${suffix}`.slice(0, 30).replace(/-+$/, '');
    if (!validateHerokuAppName(name)) continue;
    if (await Deployment.exists({ appName: name, status: { $ne: 'deleted' } })) continue;
    if (await herokuAppNameAvailable(name)) return res.json({ available: true, name, prefix: `${prefix}-`, scope: 'connected-account' });
  }
  return res.status(503).json({ error: 'Could not find an available Heroku name right now. Try another prefix.' });
}));

app.get('/api/app-name/check', requireAuth, asyncRoute(async (req, res) => {
  const name = normalizeHerokuAppName(req.query.name);
  if (!validateHerokuAppName(name)) return res.status(400).json({ available: false, error: 'Use 3–30 lowercase letters, numbers and hyphens; start with a letter and end with a letter or number.' });
  if (await Deployment.exists({ appName: name, status: { $ne: 'deleted' } })) {
    return res.json({ available: false, name, message: 'This name is already registered in TEDDY TECH BOT DEPLOYER.' });
  }
  const available = await herokuAppNameAvailable(name);
  return res.json({ available, name, message: available ? 'This name is not present in the connected Heroku account. Heroku will make the final global availability check when deployment starts.' : 'This name is already taken in the connected Heroku account.' });
}));

// ----------------------------- DEPLOYMENTS ---------------------------------
async function canAccessDeployment(req, appName) {
  const query = { appName: String(appName).toLowerCase(), status: { $ne: 'deleted' } };
  if (req.user.role !== 'admin') query.userId = req.user._id;
  const deployment = await Deployment.findOne(query);
  if (req.user.role !== 'admin' && !deployment) {
    const error = new Error('This application does not belong to your account.'); error.status = 403; throw error;
  }
  return deployment;
}

app.post('/api/deploy', requireAuth, asyncRoute(async (req, res) => {
  const name = normalizeHerokuAppName(req.body.name);
  const botName = String(req.body.botName || 'CUSTOM GITHUB BOT').trim().slice(0, 80);
  const repoUrl = String(req.body.repoUrl || '').trim();
  const branch = String(req.body.branch || 'main').trim();
  const supplied = req.body.env || {};
  if (!validateHerokuAppName(name)) return res.status(400).json({ error: 'Heroku app name must be 3–30 characters, start with a letter and end with a letter or number.' });
  if (!repoUrl) return res.status(400).json({ error: 'Enter the GitHub repository URL.' });
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) return res.status(400).json({ error: 'Invalid environment configuration.' });

  const { info, manifest } = await getManifest(repoUrl, branch);
  const overrides = {};
  for (const [key, spec] of Object.entries(manifest.env || {})) {
    const value = String(supplied[key] ?? '').trim();
    if (spec.required && !value && !spec.value && !spec.generator) return res.status(400).json({ error: `Missing required configuration: ${key}` });
    if (value) overrides[key] = value;
  }
  // SESSION_ID is supported for TEDDY-XMD but is not forced on other bots.
  if (supplied.SESSION_ID && !overrides.SESSION_ID) overrides.SESSION_ID = String(supplied.SESSION_ID).trim();

  const existing = await Deployment.findOne({ appName: name });
  if (existing && existing.status !== 'deleted') return res.status(409).json({ error: 'That Heroku app name is already registered in the deployer.' });
  if (await herokuAppNameAvailable(name) === false) {
    return res.status(409).json({ error: `The Heroku app name "${name}" is already taken. Choose another name or use Suggest available name.` });
  }

  let deployment;
  const mongoSession = await mongoose.startSession();
  try {
    await mongoSession.withTransaction(async () => {
      const user = await User.findOneAndUpdate({ _id: req.user._id, coins: { $gte: DEPLOY_COST } }, { $inc: { coins: -DEPLOY_COST } }, { new: true, session: mongoSession });
      if (!user) throw Object.assign(new Error(`You need ${DEPLOY_COST} coins to deploy. Please top up your wallet.`), { status: 402 });
      if (existing) {
        existing.userId = req.user._id; existing.botName = botName; existing.repoUrl = info.url; existing.repoOwner = info.owner; existing.repoName = info.repo; existing.branch = info.branch; existing.setupId = null; existing.buildId = null; existing.status = 'queued'; existing.statusMessage = 'Waiting for Heroku'; existing.coinsCharged = DEPLOY_COST; existing.refunded = false; existing.deletedAt = null; existing.updatedAt = new Date();
        await existing.save({ session: mongoSession }); deployment = existing;
      } else {
        const docs = await Deployment.create([{ userId: req.user._id, appName: name, botName, repoUrl: info.url, repoOwner: info.owner, repoName: info.repo, branch: info.branch, status: 'queued', statusMessage: 'Waiting for Heroku', coinsCharged: DEPLOY_COST }], { session: mongoSession });
        deployment = docs[0];
      }
      await WalletTransaction.create([{ userId: req.user._id, type: 'deployment_charge', delta: -DEPLOY_COST, balanceAfter: user.coins, reference: name, description: `Deployment charge for ${botName} (${name})` }], { session: mongoSession });
    });
  } finally { await mongoSession.endSession(); }

  try {
    const setup = await heroku('/app-setups', {
      method: 'POST',
      body: JSON.stringify({
        app: { name },
        source_blob: { url: info.tarball },
        ...(Object.keys(overrides).length ? { overrides: { env: overrides } } : {})
      })
    });
    deployment.setupId = setup.id;
    deployment.status = 'building';
    deployment.statusMessage = 'Heroku is preparing the build.';
    deployment.updatedAt = new Date();
    await deployment.save();
    res.json({ ok: true, setup, coinsCharged: DEPLOY_COST, balance: (await User.findById(req.user._id)).coins });
  } catch (error) {
    await refundDeployment(deployment, error.message);
    throw error;
  }
}));

app.get('/api/setups/:id', requireAuth, asyncRoute(async (req, res) => {
  const deployment = await Deployment.findOne({ setupId: req.params.id });
  if (!deployment) return res.status(404).json({ error: 'Deployment setup not found.' });
  if (req.user.role !== 'admin' && String(deployment.userId) !== String(req.user._id)) return res.status(403).json({ error: 'You cannot view this deployment.' });
  const setup = await heroku(`/app-setups/${encodeURIComponent(req.params.id)}`);
  let buildResult = null;
  if (setup.app?.name && setup.build?.id && setup.build.status === 'succeeded') {
    try { buildResult = await heroku(`/apps/${encodeURIComponent(setup.app.name)}/builds/${encodeURIComponent(setup.build.id)}/result`); } catch {}
  }
  const setupStatus = String(setup.status || 'pending').toLowerCase();
  const buildStatus = String(setup.build?.status || '').toLowerCase();
  if (['failed', 'failure', 'canceled', 'cancelled', 'errored'].includes(setupStatus) || ['failed', 'failure', 'canceled', 'cancelled', 'errored'].includes(buildStatus)) {
    await refundDeployment(deployment, setup.failure_message || setup.build?.status || 'Heroku build failed');
  } else {
    deployment.status = ['succeeded', 'success', 'complete', 'completed'].includes(setupStatus) ? 'deploying' : 'building';
    deployment.statusMessage = `Setup: ${setupStatus}; build: ${buildStatus || 'waiting'}`;
    deployment.buildId = setup.build?.id || deployment.buildId;
    deployment.updatedAt = new Date();
    await deployment.save();
  }
  res.json({ setup, buildResult, deployment: { appName: deployment.appName, status: deployment.status, refunded: deployment.refunded } });
}));

// Live Heroku build output for an app setup. Stream URL and Heroku token stay server-side.
app.get('/api/setups/:id/build-logs', requireAuth, asyncRoute(async (req, res) => {
  const deployment = await Deployment.findOne({ setupId: req.params.id });
  if (!deployment) return res.status(404).type('text/plain').send('Deployment not found.');
  if (req.user.role !== 'admin' && String(deployment.userId) !== String(req.user._id)) return res.status(403).type('text/plain').send('Access denied.');
  const setup = await heroku(`/app-setups/${encodeURIComponent(req.params.id)}`);
  const streamUrl = setup.build?.output_stream_url;
  if (!streamUrl) return res.status(202).type('text/plain').send('Waiting for Heroku to start the build and publish its logs…\n');
  const parsed = new URL(streamUrl);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'build-output.heroku.com') return res.status(502).type('text/plain').send('Heroku returned an unexpected build log address.');
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const upstream = await fetch(parsed.toString(), { headers: { Accept: 'text/plain' }, signal: controller.signal });
  if (!upstream.ok) throw Object.assign(new Error(`Heroku build log stream returned ${upstream.status}.`), { status: 502 });
  res.status(200); res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!upstream.body) return res.end();
  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read(); if (done || res.destroyed) break;
    if (!res.write(Buffer.from(value))) await new Promise(resolve => res.once('drain', resolve));
  }
  if (!res.destroyed) res.end();
}));

// ----------------------------- APP LIST / STATUS ----------------------------
async function herokuAppSummary(appData, deployment) {
  try {
    const [dynos, formation] = await Promise.all([
      heroku(`/apps/${encodeURIComponent(appData.name)}/dynos`),
      heroku(`/apps/${encodeURIComponent(appData.name)}/formation`)
    ]);
    const webDynos = dynos.filter(d => d.type === 'web');
    const running = webDynos.filter(d => d.state === 'up').length;
    const starting = webDynos.some(d => ['starting', 'restarting'].includes(d.state));
    const crashed = webDynos.some(d => d.state === 'crashed');
    const webFormation = formation.find(f => f.type === 'web');
    const desired = webFormation ? Number(webFormation.quantity || 0) : 0;
    let status = appData.maintenance ? 'maintenance' : running > 0 ? 'running' : starting ? 'starting' : crashed ? 'offline' : desired === 0 ? 'scaled-down' : 'offline';
    if (deployment && running === 0 && !crashed && !appData.maintenance && ['queued', 'building', 'deploying'].includes(deployment.status)) {
      status = deployment.status === 'queued' ? 'building' : deployment.status;
    }
    if (deployment?.status === 'failed') status = 'failed';
    if (running > 0 && deployment && deployment.status !== 'running') {
      deployment.status = 'running'; deployment.statusMessage = 'Web dyno is running.'; deployment.updatedAt = new Date(); await deployment.save();
    } else if (crashed && deployment && deployment.status !== 'failed' && deployment.status !== 'offline') {
      deployment.status = 'offline'; deployment.statusMessage = 'The web dyno crashed after deployment.'; deployment.updatedAt = new Date(); await deployment.save();
    }
    return {
      id: appData.id, name: appData.name, web_url: appData.web_url,
      created_at: appData.created_at, updated_at: appData.updated_at,
      region: appData.region?.name || null, stack: appData.stack?.name || null,
      maintenance: appData.maintenance, status,
      status_reason: deployment?.status === 'failed' ? (deployment.statusMessage || 'Deployment failed; coins refunded.') : crashed ? 'The web dyno crashed.' : null,
      running_dynos: running, total_web_dynos: webDynos.length,
      desired_web_dynos: desired,
      owner_email: deployment?.ownerEmail || undefined,
      bot_name: deployment?.botName || undefined,
      repo_url: deployment?.repoUrl || undefined,
      setup_id: deployment?.setupId || undefined,
      build_id: deployment?.buildId || undefined,
      deployment_status: deployment?.status || undefined,
      refunded: deployment?.refunded || false
    };
  } catch (error) {
    return { id: appData.id, name: appData.name, web_url: appData.web_url, status: 'unknown', error: error.message, owner_email: deployment?.ownerEmail || undefined };
  }
}

app.get('/api/apps', requireAuth, asyncRoute(async (req, res) => {
  let appRecords = [];
  let deployments;
  if (req.user.role === 'admin') {
    const all = await heroku('/apps');
    deployments = await Deployment.find({ status: { $ne: 'deleted' } }).populate('userId', 'email name');
    const map = new Map(deployments.map(d => [d.appName, d]));
    appRecords = all.map(a => ({ app: a, deployment: map.get(a.name) || null }));
  } else {
    deployments = await Deployment.find({ userId: req.user._id, status: { $ne: 'deleted' } }).populate('userId', 'email name').sort({ createdAt: -1 });
    for (const d of deployments) {
      try {
        const appData = await heroku(`/apps/${encodeURIComponent(d.appName)}`);
        appRecords.push({ app: appData, deployment: d });
      } catch (error) {
        if (error.status === 404) appRecords.push({ app: { id: d.appName, name: d.appName, web_url: null }, deployment: d, missing: true });
        else throw error;
      }
    }
  }
  const results = await Promise.all(appRecords.map(async ({ app: appData, deployment, missing }) => {
    if (deployment) {
      deployment.ownerEmail = deployment.userId?.email;
      deployment.botName = deployment.botName;
      deployment.repoUrl = deployment.repoUrl;
      // Poll setup state while it is not yet live, so failed builds are refunded even if logs are not opened.
      if (deployment.setupId && ['queued', 'building', 'deploying'].includes(deployment.status)) {
        try {
          const setup = await heroku(`/app-setups/${encodeURIComponent(deployment.setupId)}`);
          const s = String(setup.status || '').toLowerCase();
          const b = String(setup.build?.status || '').toLowerCase();
          if (['failed', 'failure', 'canceled', 'cancelled', 'errored'].includes(s) || ['failed', 'failure', 'canceled', 'cancelled', 'errored'].includes(b)) await refundDeployment(deployment, setup.failure_message || 'Heroku build failed');
          else if (['succeeded', 'success', 'complete', 'completed'].includes(s)) { deployment.status = 'deploying'; deployment.buildId = setup.build?.id || deployment.buildId; await deployment.save(); }
        } catch (e) { console.warn('Setup refresh failed:', e.message); }
      }
      else if (deployment.buildId && deployment.status === 'building') {
        try {
          const build = await heroku(`/apps/${encodeURIComponent(deployment.appName)}/builds/${encodeURIComponent(deployment.buildId)}`);
          const buildState = String(build.status || '').toLowerCase();
          if (['failed', 'failure', 'canceled', 'cancelled', 'errored'].includes(buildState)) await refundDeployment(deployment, build.error_message || 'Heroku redeployment build failed');
          else if (['succeeded', 'success'].includes(buildState)) { deployment.status = 'deploying'; deployment.statusMessage = 'Build completed; waiting for the web dyno.'; deployment.updatedAt = new Date(); await deployment.save(); }
        } catch (e) { console.warn('Build refresh failed:', e.message); }
      }
    }
    if (missing) return { id: appData.id, name: appData.name, web_url: null, status: deployment?.status === 'failed' ? 'failed' : 'offline', status_reason: deployment?.statusMessage || 'This app was not found in Heroku.', bot_name: deployment?.botName, setup_id: deployment?.setupId, build_id: deployment?.buildId };
    return herokuAppSummary(appData, deployment);
  }));
  res.set('Cache-Control', 'no-store');
  res.json(results);
}));

app.get('/api/deployments', requireAuth, asyncRoute(async (req, res) => {
  const query = req.user.role === 'admin' ? {} : { userId: req.user._id };
  const list = await Deployment.find(query).populate('userId', 'name email').sort({ createdAt: -1 }).limit(200);
  res.json(list.map(d => ({ id: d._id, user: d.userId ? { name: d.userId.name, email: d.userId.email } : null, appName: d.appName, botName: d.botName, repoUrl: d.repoUrl, branch: d.branch, setupId: d.setupId, buildId: d.buildId, status: d.status, statusMessage: d.statusMessage, coinsCharged: d.coinsCharged, refunded: d.refunded, createdAt: d.createdAt })));
}));

app.get('/api/apps/:name', requireAuth, asyncRoute(async (req, res) => {
  await canAccessDeployment(req, req.params.name);
  const name = encodeURIComponent(req.params.name);
  const [details, formation, configVars] = await Promise.all([heroku(`/apps/${name}`), heroku(`/apps/${name}/formation`), heroku(`/apps/${name}/config-vars`)]);
  res.json({ details, formation, configVars });
}));

app.post('/api/apps/:name/restart', requireAuth, asyncRoute(async (req, res) => {
  const nameRaw = req.params.name;
  await canAccessDeployment(req, nameRaw);
  if ((config.PROTECTED_APP_NAMES || []).includes(nameRaw)) return res.status(403).json({ error: 'This app is protected.' });
  await heroku(`/apps/${encodeURIComponent(nameRaw)}/dynos`, { method: 'DELETE' });
  res.json({ ok: true, message: 'Restart requested.' });
}));

app.post('/api/apps/:name/redeploy', requireAuth, asyncRoute(async (req, res) => {
  const nameRaw = req.params.name;
  if ((config.PROTECTED_APP_NAMES || []).includes(nameRaw)) return res.status(403).json({ error: 'This app is protected.' });
  const deployment = await canAccessDeployment(req, nameRaw);
  if (!deployment) return res.status(400).json({ error: 'This app has no saved repository details. Delete and deploy it again with a repository URL.' });
  const balance = await chargeCoins(req.user._id, DEPLOY_COST, 'redeploy_charge', `Redeployment charge for ${nameRaw}`, nameRaw);
  try {
    const info = repoSource({ owner: deployment.repoOwner, repo: deployment.repoName }, deployment.branch);
    const build = await heroku(`/apps/${encodeURIComponent(nameRaw)}/builds`, { method: 'POST', body: JSON.stringify({ source_blob: { url: info.tarball, version_description: `Deploy ${deployment.repoOwner}/${deployment.repoName}@${deployment.branch}` } }) });
    deployment.buildId = build.id; deployment.setupId = null; deployment.status = 'building'; deployment.statusMessage = 'Redeployment build started.'; deployment.coinsCharged = DEPLOY_COST; deployment.refunded = false; deployment.updatedAt = new Date(); await deployment.save();
    res.json({ ok: true, build, balance });
  } catch (error) {
    const mongoSession = await mongoose.startSession();
    try { await mongoSession.withTransaction(async () => {
      const user = await User.findByIdAndUpdate(req.user._id, { $inc: { coins: DEPLOY_COST } }, { new: true, session: mongoSession });
      await WalletTransaction.create([{ userId: req.user._id, type: 'redeploy_refund', delta: DEPLOY_COST, balanceAfter: user.coins, reference: nameRaw, description: `Refund: redeployment could not start for ${nameRaw}` }], { session: mongoSession });
    }); } finally { await mongoSession.endSession(); }
    throw error;
  }
}));

app.delete('/api/apps/:name', requireAuth, asyncRoute(async (req, res) => {
  const nameRaw = req.params.name;
  const deployment = await canAccessDeployment(req, nameRaw);
  if ((config.PROTECTED_APP_NAMES || []).includes(nameRaw)) return res.status(403).json({ error: 'This app is protected.' });
  if (String(req.body.confirm || '') !== nameRaw) return res.status(400).json({ error: 'Confirmation does not match app name.' });
  await heroku(`/apps/${encodeURIComponent(nameRaw)}`, { method: 'DELETE' });
  if (deployment) { deployment.status = 'deleted'; deployment.deletedAt = new Date(); deployment.updatedAt = new Date(); await deployment.save(); }
  res.json({ ok: true });
}));

app.get('/api/apps/:name/build-logs/:buildId', requireAuth, asyncRoute(async (req, res) => {
  const deployment = await canAccessDeployment(req, req.params.name);
  const build = await heroku(`/apps/${encodeURIComponent(req.params.name)}/builds/${encodeURIComponent(req.params.buildId)}`);
  const streamUrl = build.output_stream_url;
  if (!streamUrl) return res.status(202).type('text/plain').send('Waiting for Heroku to publish this build log stream…\n');
  const parsed = new URL(streamUrl);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'build-output.heroku.com') return res.status(502).type('text/plain').send('Heroku returned an unexpected build log address.');
  const controller = new AbortController(); res.on('close', () => controller.abort());
  const upstream = await fetch(parsed.toString(), { headers: { Accept: 'text/plain' }, signal: controller.signal });
  if (!upstream.ok) throw Object.assign(new Error(`Heroku build log stream returned ${upstream.status}.`), { status: 502 });
  res.status(200); res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  if (!upstream.body) return res.end();
  const reader = upstream.body.getReader();
  while (true) { const { done, value } = await reader.read(); if (done || res.destroyed) break; if (!res.write(Buffer.from(value))) await new Promise(resolve => res.once('drain', resolve)); }
  if (!res.destroyed) res.end();
}));

app.get('/api/apps/:name/logs', requireAuth, asyncRoute(async (req, res) => {
  await canAccessDeployment(req, req.params.name);
  const name = encodeURIComponent(req.params.name);
  const logSession = await heroku(`/apps/${name}/log-sessions`, { method: 'POST', body: JSON.stringify({ lines: 200, source: 'app', dyno: null, tail: false }) });
  if (!logSession.logplex_url) return res.status(502).json({ error: 'Heroku did not return a log URL.' });
  const response = await fetch(logSession.logplex_url, { headers: { Accept: 'text/plain' } });
  if (!response.ok) throw Object.assign(new Error(`Log retrieval failed: ${response.status}`), { status: 502 });
  res.type('text/plain').send(await response.text());
}));

// ----------------------------- PAYSTACK ROUTES ------------------------------
app.post('/api/payments/initialize', requireAuth, asyncRoute(async (req, res) => {
  const coins = Number(req.body.coins);
  const currency = String(req.body.currency || 'KES').toUpperCase();
  if (!Number.isInteger(coins) || coins < 10 || coins % 10 !== 0 || coins > 100000) return res.status(400).json({ error: 'Choose a coin amount in multiples of 10 (minimum 10 coins).' });
  if (!['KES', 'USD'].includes(currency)) return res.status(400).json({ error: 'Choose KES or USD.' });
  const packs = coins / 10;
  let amountMinor;
  if (currency === 'KES') amountMinor = Math.round(packs * KES_PER_10_COINS * 100);
  else {
    amountMinor = Math.round(packs * USD_PER_10_COINS * 100);
    if (amountMinor < Math.round(USD_MINIMUM * 100)) return res.status(400).json({ error: `Paystack USD checkout minimum is $${USD_MINIMUM.toFixed(2)}. Choose at least ${Math.ceil(USD_MINIMUM / USD_PER_10_COINS) * 10} coins for USD, or pay in KES to buy 10 coins.` });
  }
  const reference = `Teddy${Date.now()}${crypto.randomBytes(5).toString('hex')}`;
  const payment = await Payment.create({ userId: req.user._id, reference, coins, amountMinor, currency, status: 'pending' });
  const callbackUrl = `${getPublicBase(req)}/api/payments/callback`;
  try {
    const data = await paystackRequest('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: req.user.email,
        amount: amountMinor,
        currency,
        reference,
        callback_url: callbackUrl,
        channels: currency === 'USD' ? ['card'] : ['card', 'mobile_money', 'bank_transfer'],
        metadata: { user_id: String(req.user._id), coins, currency }
      })
    });
    payment.authorizationUrl = data.authorization_url; await payment.save();
    res.json({ ok: true, authorizationUrl: data.authorization_url, reference, coins, amountMinor, currency });
  } catch (error) {
    payment.status = 'initialization_failed'; await payment.save(); throw error;
  }
}));

app.get('/api/payments/callback', asyncRoute(async (req, res) => {
  const reference = String(req.query.reference || '');
  if (!reference) return res.redirect('/?payment=missing');
  try {
    const payment = await verifyPaystackReference(reference);
    return res.redirect(payment.credited ? '/?payment=success' : '/?payment=pending');
  } catch (error) {
    console.error('Paystack callback verification failed:', error.message);
    return res.redirect('/?payment=failed');
  }
}));

// Webhook signature validation. Paystack also calls the callback; unique reference + Mongo transaction prevent double credit.
app.post('/api/payments/webhook', asyncRoute(async (req, res) => {
  if (!config.PAYSTACK_SECRET_KEY) return res.sendStatus(503);
  const signature = String(req.headers['x-paystack-signature'] || '');
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expected = crypto.createHmac('sha512', config.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
  let event; try { event = req.body; if (!event || typeof event !== 'object') event = JSON.parse(rawBody.toString('utf8')); } catch { return res.sendStatus(400); }
  if (event.event === 'charge.success' && event.data?.reference) {
    try { await verifyPaystackReference(event.data.reference); } catch (error) { console.warn('Paystack webhook fulfillment deferred:', error.message); }
  }
  res.sendStatus(200);
}));

app.get('/api/wallet', requireAuth, asyncRoute(async (req, res) => {
  const [user, transactions, payments] = await Promise.all([
    User.findById(req.user._id).select('coins'),
    WalletTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50),
    Payment.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(20).select('-authorizationUrl')
  ]);
  res.json({ coins: user.coins, transactions, payments, pricing: { kesPer10Coins: KES_PER_10_COINS, usdPer10Coins: USD_PER_10_COINS, usdMinimum: USD_MINIMUM, usdMinimumCoins: Math.ceil(USD_MINIMUM / USD_PER_10_COINS) * 10 } });
}));

// ----------------------------- ADMIN ROUTES ---------------------------------
app.get('/api/admin/summary', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const [users, deployments, payments, coins] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    Deployment.countDocuments({ status: { $ne: 'deleted' } }),
    Payment.countDocuments({ status: 'success' }),
    User.aggregate([{ $group: { _id: null, total: { $sum: '$coins' } } }])
  ]);
  res.json({ users, deployments, successfulPayments: payments, coinsInWallets: coins[0]?.total || 0 });
}));

app.get('/api/admin/users', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 }).limit(500);
  res.json(users);
}));

app.post('/api/admin/users/:id/coins', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const delta = Number(req.body.delta);
  const reason = String(req.body.reason || 'Admin wallet adjustment').trim().slice(0, 200);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000000) return res.status(400).json({ error: 'Enter a non-zero whole number of coins.' });
  const mongoSession = await mongoose.startSession();
  let updated;
  try {
    await mongoSession.withTransaction(async () => {
      const query = { _id: req.params.id };
      if (delta < 0) query.coins = { $gte: Math.abs(delta) };
      updated = await User.findOneAndUpdate(query, { $inc: { coins: delta } }, { new: true, session: mongoSession }).select('-passwordHash');
      if (!updated) throw Object.assign(new Error(delta < 0 ? 'User does not exist or has insufficient coins.' : 'User not found.'), { status: 404 });
      await WalletTransaction.create([{ userId: updated._id, type: 'admin_adjustment', delta, balanceAfter: updated.coins, description: reason }], { session: mongoSession });
    });
  } finally { await mongoSession.endSession(); }
  res.json({ ok: true, user: updated });
}));

app.get('/api/admin/payments', requireAuth, requireAdmin, asyncRoute(async (req, res) => {
  const rows = await Payment.find().populate('userId', 'name email').sort({ createdAt: -1 }).limit(300);
  res.json(rows.map(p => ({ reference: p.reference, user: p.userId ? { name: p.userId.name, email: p.userId.email } : null, coins: p.coins, amountMinor: p.amountMinor, currency: p.currency, status: p.status, credited: p.credited, createdAt: p.createdAt, paidAt: p.paidAt })));
}));

// ----------------------------- APK / FRONTEND -------------------------------
app.get('/downloads/TEDDY-XMD.apk', (req, res) => {
  const apkPath = path.join(__dirname, 'public', 'downloads', 'TEDDY-XMD.apk');
  if (!fs.existsSync(apkPath)) return res.status(404).type('text/plain').send('TEDDY-XMD Android APK is not available yet.');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="TEDDY-XMD.apk"');
  return res.sendFile(apkPath);
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ----------------------------- STARTUP --------------------------------------
async function start() {
  if (!config.MONGODB_URI || String(config.MONGODB_URI).includes('PASTE_YOUR_')) {
    console.error('Set MONGODB_URI in config.js to your MongoDB Atlas connection string.');
    process.exit(1);
  }
  if (!config.SESSION_SECRET || String(config.SESSION_SECRET).length < 32 || String(config.SESSION_SECRET).startsWith('REPLACE_WITH_')) {
    console.error('Set SESSION_SECRET in config.js to a unique random value of at least 32 characters.');
    process.exit(1);
  }
  if (!config.ADMIN?.EMAIL || String(config.ADMIN.EMAIL).startsWith('YOUR_') || !config.ADMIN?.PASSWORD || String(config.ADMIN.PASSWORD).startsWith('CHANGE_THIS') || String(config.ADMIN.PASSWORD).length < 8) {
    console.error('Set ADMIN.EMAIL and a strong ADMIN.PASSWORD in config.js (at least 8 characters).');
    process.exit(1);
  }
  if (!config.HEROKU_API_KEY || String(config.HEROKU_API_KEY).includes('PASTE_YOUR_')) {
    console.error('Set HEROKU_API_KEY in config.js.');
    process.exit(1);
  }
  if (!config.PAYSTACK_SECRET_KEY || String(config.PAYSTACK_SECRET_KEY).includes('PASTE_YOUR_')) {
    console.error('Set PAYSTACK_SECRET_KEY in config.js before enabling coin purchases.');
    process.exit(1);
  }
  if (!config.PUBLIC_URL || String(config.PUBLIC_URL).includes('YOUR-APP-NAME')) {
    console.error('Set PUBLIC_URL in config.js to the full public URL of this panel.');
    process.exit(1);
  }
  await mongoose.connect(config.MONGODB_URI);
  console.log('Connected to MongoDB Atlas.');

  // Migration for older database versions: this release identifies users by
  // email and has no username field. A leftover unique username_1 index from
  // an older schema rejects every second document with username=null.
  // Remove only that obsolete index; never delete users or other collections.
  try {
    const userIndexes = await User.collection.indexes();
    if (userIndexes.some(index => index.name === 'username_1')) {
      await User.collection.dropIndex('username_1');
      console.log('Removed obsolete MongoDB users.username_1 index.');
    }
  } catch (indexError) {
    // A missing users collection/index is normal on a fresh installation.
    if (![26, 27].includes(indexError.code) && !/not found|ns does not exist/i.test(indexError.message || '')) {
      throw indexError;
    }
  }

  const adminEmail = String(config.ADMIN.EMAIL || '').trim().toLowerCase();
  const adminPassword = String(config.ADMIN.PASSWORD || '');
  if (!adminEmail || adminPassword.length < 8) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 8 characters).');
  let admin = await User.findOne({ email: adminEmail });
  if (!admin) {
    admin = await User.create({ name: 'Teddy Tech Admin', email: adminEmail, passwordHash: await bcrypt.hash(adminPassword, 12), role: 'admin', coins: 0 });
    console.log(`Created administrator account: ${adminEmail}`);
  } else if (admin.role !== 'admin') {
    admin.role = 'admin'; await admin.save();
  }
  app.listen(PORT, () => console.log(`TEDDY TECH BOT DEPLOYER listening on ${PORT}`));
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  sendError(res, error);
});

start().catch(error => { console.error('Startup failed:', error.message); process.exit(1); });
