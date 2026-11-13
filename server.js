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
const USD_MINIMUM = Number(config.PAYSTACK_USD_MINIMUM || 0.4);

// Binance Pay MANUAL - no Binance API. User sends USDT to UID/Email, uploads receipt, admin approves on Telegram. Approval NEVER expires.
const BINANCE_PAY_ENABLED = true;
const BINANCE_PAY_COMING_SOON = false;
const BINANCE_PAY_UID = config.BINANCE_PAY_UID || config.BINANCE_PAY_ID || '';
const BINANCE_PAY_EMAIL = config.BINANCE_PAY_EMAIL || '';
const MPESA_MANUAL_ENABLED = true;
const MPESA_RECEIVER_PHONE = config.MPESA_RECEIVER_PHONE || '254799963583';
const MPESA_RECEIVER_NAME = config.MPESA_RECEIVER_NAME || 'Wycliffe Kibet';
const TELEGRAM_BOT_TOKEN = config.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_ADMIN_CHAT_ID = config.TELEGRAM_ADMIN_CHAT_ID || '';

// Allowed env vars — ONLY for TEDDY-XMD, full app.json 26 vars
const ALLOWED_ENV_KEYS = [
  'SESSION_ID',
  'BOT_MODE','ANTIDELETE_MODE','STATUS_MODE','ANTILINK_ACTION','PREFIX','OWNER_NUMBER','TIMEZONE',
  'AUTOSTATUSVIEW','AUTOREACTSTATUS','AUTOREACTSTATUS_EMOJI','AUTOREACTSTATUS_RANDOM',
  'BOT_NAME','AUTOREAD','AUTOREACT','ANTIEDIT_MODE','ANTIDELETE_STATUS','ALWAYS_ONLINE',
  'FONT_STYLE','READ_RECEIPTS','AUTOREAD_MODE','AUTO_BIO','AUTO_STICKER',
  'AUTO_TYPING','AUTO_RECORDING','AUTO_RECORDTYPE'
];
function buildEnvOverrides(supplied){
  const overrides = {};
  const boolKeys = ['AUTOSTATUSVIEW','AUTOREACTSTATUS','AUTOREACTSTATUS_RANDOM','AUTOREAD','AUTOREACT','ANTIDELETE_STATUS','ALWAYS_ONLINE','AUTO_BIO','AUTO_STICKER','AUTO_TYPING','AUTO_RECORDING','AUTO_RECORDTYPE'];
  for(const key of ALLOWED_ENV_KEYS){
    let v = supplied[key];
    if(v===undefined||v===null) continue;
    v = String(v).trim();
    if(v==='') continue;
    if(key==='OWNER_NUMBER' && !/^\d{7,15}$/.test(v)) throw Object.assign(new Error('OWNER_NUMBER must be digits only with country code, e.g. 254799963583'),{status:400});
    if(key==='PREFIX' && v.length>5) throw Object.assign(new Error('PREFIX must be 1-5 characters.'),{status:400});
    if(key==='BOT_MODE' && !['public','private','group','pm','self'].includes(v.toLowerCase())) throw Object.assign(new Error('BOT_MODE must be public, private, group, pm or self.'),{status:400});
    if(boolKeys.includes(key) && !['true','false'].includes(v.toLowerCase())) throw Object.assign(new Error(key+' must be true or false.'),{status:400});
    if(key==='ANTIDELETE_MODE' && !['off','chat','private'].includes(v.toLowerCase())) throw Object.assign(new Error('ANTIDELETE_MODE must be off, chat or private.'),{status:400});
    if(key==='ANTIEDIT_MODE' && !['off','chat','private'].includes(v.toLowerCase())) throw Object.assign(new Error('ANTIEDIT_MODE must be off, chat or private.'),{status:400});
    if(key==='STATUS_MODE' && !['off','typing','recording','recordtype'].includes(v.toLowerCase())) throw Object.assign(new Error('STATUS_MODE must be off, typing, recording or recordtype.'),{status:400});
    if(key==='ANTILINK_ACTION' && !['off','delete','kick'].includes(v.toLowerCase())) throw Object.assign(new Error('ANTILINK_ACTION must be off, delete or kick.'),{status:400});
    if(key==='READ_RECEIPTS' && !['off','all','read'].includes(v.toLowerCase())) throw Object.assign(new Error('READ_RECEIPTS must be off, all or read.'),{status:400});
    if(key==='AUTOREAD_MODE' && !['off','all','private','group'].includes(v.toLowerCase())) throw Object.assign(new Error('AUTOREAD_MODE must be off, all, private or group.'),{status:400});
    overrides[key]=v;
  }
  return overrides;
}

mongoose.set('strictQuery', true);
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
  repoOwner: String, repoName: String, branch: { type: String, default: 'main' },
  setupId: String, buildId: String, status: { type: String, default: 'queued' }, statusMessage: String,
  coinsCharged: { type: Number, default: DEPLOY_COST }, refunded: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }, deletedAt: Date
}, { versionKey: false });
const paymentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reference: { type: String, required: true, unique: true },
  coins: { type: Number, required: true }, amountMinor: { type: Number, required: true },
  currency: { type: String, enum: ['KES', 'USD', 'BINANCE_USD'], required: true },
  provider: { type: String, enum: ['paystack', 'binance-pay', 'mpesa-manual'], default: 'paystack' },
  status: { type: String, default: 'pending' }, credited: { type: Boolean, default: false },
  authorizationUrl: String,
  receiptImage: String, receiptUploadedAt: Date, adminNote: String,
  binanceUid: String, binanceEmail: String, country: String, customerPaymentRef: String,
  createdAt: { type: Date, default: Date.now }, paidAt: Date
}, { versionKey: false });
const walletTransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, required: true }, delta: { type: Number, required: true },
  balanceAfter: { type: Number, required: true }, reference: { type: String, default: null },
  description: { type: String, default: '' }, createdAt: { type: Date, default: Date.now }
}, { versionKey: false });
const User = mongoose.model('User', userSchema);
const Deployment = mongoose.model('Deployment', deploymentSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);
const supportTicketSchema = new mongoose.Schema({
  ticketNumber:{type:String,required:true,unique:true,index:true}, userId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},
  subject:{type:String,required:true,trim:true,maxlength:120}, status:{type:String,enum:['open','waiting_user','closed','pending','resolved'],default:'open',index:true},
  messages:[{sender:{type:String,enum:['user','admin','system'],required:true},body:{type:String,required:true,maxlength:4000},createdAt:{type:Date,default:Date.now},broadcastId:{type:String},clientMessageId:{type:String},readByAdmin:{type:Boolean,default:false},readByCustomer:{type:Boolean,default:false}}],
  createdAt:{type:Date,default:Date.now},updatedAt:{type:Date,default:Date.now}
},{versionKey:false});
const SupportTicket=mongoose.model('SupportTicket',supportTicketSchema);


app.set('trust proxy', 1);
// Lightweight health check for Heroku/router monitoring.
app.get('/health', (req,res) => res.status(200).json({ ok:true, service:'teddy-tech-deployer' }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb', verify: (req, res, buffer) => { if (req.originalUrl.startsWith('/api/payments/webhook') || req.originalUrl.startsWith('/api/binance-pay/webhook')) req.rawBody = Buffer.from(buffer); } }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: 'teddy_deployer_sid', secret: config.SESSION_SECRET, resave: false, saveUninitialized: false,
  store: config.MONGODB_URI ? MongoStore.create({ mongoUrl: config.MONGODB_URI, collectionName: 'sessions', ttl: 8*60*60 }) : undefined,
  cookie: { httpOnly: true, sameSite: 'lax', secure: (config.NODE_ENV || process.env.NODE_ENV) === 'production', maxAge: 8*60*60*1000 }
}));
const authLimiter = rateLimit({ windowMs: 15*60*1000, limit: 15, standardHeaders: true, legacyHeaders: false });
app.use(['/api/login', '/api/register'], authLimiter);
app.use('/api/payments/initialize', rateLimit({ windowMs: 10*60*1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
app.use('/api/binance-pay/initialize', rateLimit({ windowMs: 10*60*1000, limit: 10, standardHeaders: true, legacyHeaders: false }));
function asyncRoute(fn){ return (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next); }
async function requireAuth(req,res,next){
  try{
    if(!req.session?.userId) return res.status(401).json({error:'Please sign in to continue.'});
    const user = await User.findById(req.session.userId).select('-passwordHash');
    if(!user){ req.session.destroy(()=>{}); return res.status(401).json({error:'Your account session has expired. Please sign in again.'}); }
    req.user=user; next();
  }catch(e){ next(e); }
}
function requireAdmin(req,res,next){ if(req.user?.role==='admin') return next(); return res.status(403).json({error:'Administrator access required.'}); }
function sendError(res,error){ console.error('API error:',error.message); const status=error.status&&error.status>=400&&error.status<500?error.status:500; res.status(status).json({error:error.message||'Unexpected server error'}); }
const HEROKU_HEADERS = { Authorization:`Bearer ${config.HEROKU_API_KEY}`, Accept:'application/vnd.heroku+json; version=3', 'Content-Type':'application/json' };
async function heroku(pathname,options={}){
  if(!config.HEROKU_API_KEY||String(config.HEROKU_API_KEY).includes('PASTE_YOUR')){ const e=new Error('Set HEROKU_API_KEY in your Heroku Config Vars.'); e.status=503; throw e; }
  const response=await fetch(`${HEROKU_API}${pathname}`,{...options,headers:{...HEROKU_HEADERS,...(options.headers||{})}});
  const raw=await response.text(); let data={}; try{ data=raw?JSON.parse(raw):{}; }catch{ data={message:raw}; }
  if(!response.ok){ const e=new Error(data.message||data.error||`Heroku API returned ${response.status}`); e.status=response.status; throw e; }
  return data;
}
function getPublicBase(req){ if(config.PUBLIC_URL) return String(config.PUBLIC_URL).replace(/\/$/,''); return `${req.protocol}://${req.get('host')}`; }
function parseGithubRepo(value){
  let parsed; try{ parsed=new URL(String(value||'').trim()); }catch{ throw Object.assign(new Error('Enter a valid public GitHub repository URL.'),{status:400}); }
  if(parsed.hostname.toLowerCase()!=='github.com'||!['https:','http:'].includes(parsed.protocol)) throw Object.assign(new Error('Only public GitHub repository URLs are supported.'),{status:400});
  const parts=parsed.pathname.split('/').filter(Boolean);
  if(parts.length<2) throw Object.assign(new Error('GitHub URL must look like https://github.com/owner/repository.'),{status:400});
  const owner=parts[0]; const repo=parts[1].replace(/\.git$/i,'');
  if(!/^[A-Za-z0-9_.-]{1,100}$/.test(owner)||!/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) throw Object.assign(new Error('The GitHub repository URL is not valid.'),{status:400});
  return {owner,repo,url:`https://github.com/${owner}/${repo}`};
}
function repoSource(repo,branch){
  const safeBranch=String(branch||'main').trim();
  if(!safeBranch||safeBranch.length>200||safeBranch.includes('..')) throw Object.assign(new Error('Enter a valid Git branch name.'),{status:400});
  return { owner:repo.owner, repo:repo.repo, url:repo.url, branch:safeBranch, tarball:`https://codeload.github.com/${repo.owner}/${repo.repo}/tar.gz/refs/heads/${encodeURIComponent(safeBranch)}`, rawManifest:`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${encodeURIComponent(safeBranch)}/app.json` };
}
function normalizeHerokuAppName(v){ return String(v||'').trim().toLowerCase(); }
function validateHerokuAppName(n){ return /^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(n); }
async function herokuAppNameAvailable(name){ try{ await heroku(`/apps/${encodeURIComponent(name)}`); return false; }catch(e){ if(e.status===404) return true; throw e; } }
function normalizeAppPrefix(value){ let p=String(value||config.DEFAULT_HEROKU_APP_PREFIX||'teddyxhost').trim().toLowerCase().replace(/[^a-z0-9-]/g,'').replace(/^-+/,'').replace(/-+$/,''); if(!p||!/^[a-z]/.test(p)) p='teddyxhost'; return p.slice(0,20); }
async function getManifest(repoUrl,branch){
  const repo=parseGithubRepo(repoUrl); const info=repoSource(repo,branch);
  const response=await fetch(info.rawManifest,{headers:{'User-Agent':'TEDDY-TECH-BOT-DEPLOYER'}});
  if(!response.ok){ const e=new Error(response.status===404?'This repository does not contain app.json on the selected branch.':`GitHub could not load app.json (${response.status}).`); e.status=response.status===404?400:502; throw e; }
  let manifest; try{ manifest=await response.json(); }catch{ throw Object.assign(new Error('The repository app.json is not valid JSON.'),{status:400}); }
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)) throw Object.assign(new Error('The repository app.json is invalid.'),{status:400});
  const env={}; for(const [key,spec] of Object.entries(manifest.env||{})){ env[key]={description:typeof spec==='string'?spec:(spec?.description||''),required:typeof spec==='object'&&spec!==null?spec.required===true:false,value:typeof spec==='object'&&spec!==null&&typeof spec.value==='string'?spec.value:'',generator:!!(typeof spec==='object'&&spec?.generator)}; }
  return {info,manifest:{name:manifest.name||repo.repo,description:manifest.description||'',env}};
}
async function paystackRequest(pathname,options={}){
  if(!config.PAYSTACK_SECRET_KEY||String(config.PAYSTACK_SECRET_KEY).includes('PASTE_YOUR')){ const e=new Error('Paystack is not configured yet. Add PAYSTACK_SECRET_KEY to Heroku Config Vars.'); e.status=503; throw e; }
  const response=await fetch(`${PAYSTACK_API}${pathname}`,{...options,headers:{Authorization:`Bearer ${config.PAYSTACK_SECRET_KEY}`,'Content-Type':'application/json',...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.status===false){ const e=new Error(data.message||`Paystack returned ${response.status}`); e.status=response.status||502; throw e; }
  return data.data;
}
function isBinancePayConfigured(){ return Boolean(BINANCE_PAY_UID || BINANCE_PAY_EMAIL); }
async function telegramApi(method, body, formData){
  if(!TELEGRAM_BOT_TOKEN) throw Object.assign(new Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN in Heroku Config Vars.'),{status:503});
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method:'POST',
    headers: formData ? undefined : {'Content-Type':'application/json'},
    body: formData || JSON.stringify(body || {})
  });
  const result = await response.json().catch(()=>({}));
  if(!response.ok || result.ok !== true){
    const message = result.description || `Telegram ${method} failed (HTTP ${response.status}).`;
    console.error('Telegram API error:', method, message);
    throw Object.assign(new Error(message),{status:502});
  }
  return result.result;
}
async function sendTelegramMessage(chatId, text, replyMarkup){
  if(!chatId) throw Object.assign(new Error('Set TELEGRAM_ADMIN_CHAT_ID in Heroku Config Vars.'),{status:503});
  return telegramApi('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',...(replyMarkup?{reply_markup:replyMarkup}:{})});
}
async function sendBinanceReceiptToTelegram(payment, user){
  if(!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) return;
  const caption = `🧾 <b>New Binance Pay Receipt</b>\n\n👤 User: ${user.name} (${user.email})\n💰 Coins: ${payment.coins}\n💵 Amount: $${(payment.amountMinor/100).toFixed(2)} USDT\n🔖 Ref: <code>${payment.reference}</code>\n⏳ Status: Pending - Waiting for Approval\n\nTap APPROVE to add coins, REJECT to decline. This never expires.`;
  const replyMarkup = { inline_keyboard: [[ { text:'✅ APPROVE', callback_data:`bn_approve:${payment.reference}` }, { text:'❌ REJECT', callback_data:`bn_reject:${payment.reference}` } ]]};
  try{
    let imgBuffer = null;
    if(payment.receiptImage && payment.receiptImage.startsWith('data:image')){
      const base64 = payment.receiptImage.split(',')[1];
      imgBuffer = Buffer.from(base64, 'base64');
    }
    if(imgBuffer){
      const form = new FormData();
      form.append('chat_id', TELEGRAM_ADMIN_CHAT_ID);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      form.append('reply_markup', JSON.stringify(replyMarkup));
      form.append('photo', new Blob([imgBuffer], {type:'image/jpeg'}), 'receipt.jpg');
      await telegramApi('sendPhoto',null,form);
    } else {
      await sendTelegramMessage(TELEGRAM_ADMIN_CHAT_ID, caption, replyMarkup);
    }
  }catch(e){ console.error('Telegram receipt failed:', e.message); throw e; }
}

async function sendMpesaReceiptToTelegram(payment, user){
  if(!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) return;
  const caption = `📱 <b>New M-Pesa Manual Payment</b>\n\n👤 User: ${user.name} (${user.email})\n🌍 Country: ${payment.country || 'Not specified'}\n💰 Coins: ${payment.coins}\n💵 Amount: KSh ${(payment.amountMinor/100).toFixed(2)}\n📞 Paid to: ${MPESA_RECEIVER_PHONE} (${MPESA_RECEIVER_NAME})\n🔖 Ref: <code>${payment.reference}</code>\n🧾 Customer transaction: <code>${payment.customerPaymentRef || 'Not provided'}</code>\n⏳ Pending manual verification.\n\nVerify the money in your M-Pesa statement before approving.`;
  const replyMarkup = { inline_keyboard: [[ { text:'✅ APPROVE', callback_data:`mp_approve:${payment.reference}` }, { text:'❌ REJECT', callback_data:`mp_reject:${payment.reference}` } ]]};
  try{
    if(payment.receiptImage && payment.receiptImage.startsWith('data:image')){
      const base64 = payment.receiptImage.split(',')[1];
      const imgBuffer = Buffer.from(base64, 'base64');
      const form = new FormData();
      form.append('chat_id', TELEGRAM_ADMIN_CHAT_ID);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      form.append('reply_markup', JSON.stringify(replyMarkup));
      form.append('photo', new Blob([imgBuffer], {type:'image/jpeg'}), 'mpesa-receipt.jpg');
      await telegramApi('sendPhoto',null,form);
    } else {
      await sendTelegramMessage(TELEGRAM_ADMIN_CHAT_ID, caption, replyMarkup);
    }
  }catch(e){ console.error('Telegram M-Pesa receipt failed:', e.message); throw e; }
}

async function addWalletCredit(paymentId,paystackData){
  const payment=await Payment.findById(paymentId); if(!payment||payment.credited) return false;
  if(paystackData.status!=='success') throw Object.assign(new Error('Payment has not been completed.'),{status:400});
  if(Number(paystackData.amount)!==Number(payment.amountMinor)||String(paystackData.currency).toUpperCase()!==payment.currency) throw Object.assign(new Error('Payment amount or currency does not match the pending order.'),{status:400});
  const user=await User.findById(payment.userId); if(!user||(paystackData.metadata?.user_id&&String(paystackData.metadata.user_id)!==String(payment.userId))) throw Object.assign(new Error('Payment metadata does not match this account.'),{status:400});
  const s=await mongoose.startSession(); let credited=false;
  try{ await s.withTransaction(async()=>{ const cur=await Payment.findOne({_id:payment._id,credited:false,status:'pending'}).session(s); if(!cur) return; const u=await User.findByIdAndUpdate(cur.userId,{$inc:{coins:cur.coins}},{new:true,session:s}); if(!u) throw new Error('Wallet account not found.'); cur.status='success'; cur.credited=true; cur.paidAt=new Date(); await cur.save({session:s}); await WalletTransaction.create([{userId:cur.userId,type:'purchase',delta:cur.coins,balanceAfter:u.coins,reference:cur.reference,description:`Purchased ${cur.coins} Teddy Coins through Paystack (${cur.currency})`}],{session:s}); credited=true; }); }finally{ await s.endSession(); }
  return credited;
}
async function creditPaymentByReference(reference,providerLabel){
  const payment=await Payment.findOne({reference}); if(!payment||payment.credited) return payment;
  const s=await mongoose.startSession();
  try{ await s.withTransaction(async()=>{ const cur=await Payment.findOne({_id:payment._id,credited:false,status:{$in:['pending','pending_receipt','awaiting_verification']}}).session(s); if(!cur) return; const u=await User.findByIdAndUpdate(cur.userId,{$inc:{coins:cur.coins}},{new:true,session:s}); if(!u) throw new Error('Wallet account not found.'); cur.status='success'; cur.credited=true; cur.paidAt=new Date(); await cur.save({session:s}); await WalletTransaction.create([{userId:cur.userId,type:'purchase',delta:cur.coins,balanceAfter:u.coins,reference:cur.reference,description:`Purchased ${cur.coins} Teddy Coins through ${providerLabel}`}],{session:s}); }); }finally{ await s.endSession(); }
  return Payment.findById(payment._id);
}
async function verifyPaystackReference(reference){
  const payment=await Payment.findOne({reference}); if(!payment) throw Object.assign(new Error('Payment reference was not found.'),{status:404});
  if(payment.credited) return payment;
  const data=await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`,{method:'GET'});
  if(data.status!=='success'){ payment.status=String(data.status||'failed'); await payment.save(); throw Object.assign(new Error('Paystack payment was not successful.'),{status:400}); }
  await addWalletCredit(payment._id,data); return Payment.findById(payment._id);
}
async function refundDeployment(deployment,reason){
  if(!deployment||deployment.refunded) return false;
  const s=await mongoose.startSession(); let refunded=false;
  try{ await s.withTransaction(async()=>{ const cur=await Deployment.findOne({_id:deployment._id,refunded:false}).session(s); if(!cur) return; const u=await User.findByIdAndUpdate(cur.userId,{$inc:{coins:cur.coinsCharged||DEPLOY_COST}},{new:true,session:s}); if(!u) throw new Error('Cannot refund deployment: user wallet is missing.'); cur.refunded=true; cur.status='failed'; cur.statusMessage=reason||'Deployment failed; coins refunded.'; cur.updatedAt=new Date(); await cur.save({session:s}); await WalletTransaction.create([{userId:cur.userId,type:'deployment_refund',delta:cur.coinsCharged||DEPLOY_COST,balanceAfter:u.coins,reference:cur.appName,description:`Refund for failed deployment ${cur.appName}: ${reason||'deployment failed'}`}],{session:s}); refunded=true; }); }finally{ await s.endSession(); }
  return refunded;
}
app.get('/api/public-config',(req,res)=>{ const n=String(config.SUPPORT_WHATSAPP||'').replace(/\D/g,''); res.set('Cache-Control','no-store'); res.json({supportWhatsApp:n,pairingWebsiteUrl:config.PAIRING_WEBSITE_URL||'',binancePay:{enabled:BINANCE_PAY_ENABLED,comingSoon:BINANCE_PAY_COMING_SOON,configured:isBinancePayConfigured()},pricing:{kesPer10Coins:KES_PER_10_COINS,usdPer10Coins:USD_PER_10_COINS,usdMinimum:USD_MINIMUM,usdMinimumCoins:Math.ceil(USD_MINIMUM/USD_PER_10_COINS)*10}}); });
app.post('/api/register',asyncRoute(async(req,res)=>{
  const name=String(req.body.name||'').trim(); const email=String(req.body.email||'').trim().toLowerCase(); const password=String(req.body.password||'');
  if(name.length<2||name.length>80) return res.status(400).json({error:'Enter your name (2–80 characters).'});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'Enter a valid email address.'});
  if(password.length<8) return res.status(400).json({error:'Password must contain at least 8 characters.'});
  if(await User.exists({email})) return res.status(409).json({error:'An account with this email already exists.'});
  const passwordHash=await bcrypt.hash(password,12); let user;
  try{ user=await User.create({name,email,passwordHash,role:'user',coins:0}); }catch(e){ if(e?.code===11000) return res.status(409).json({error:'An account with this email already exists.'}); throw e; }
  req.session.regenerate(err=>{ if(err) return res.status(500).json({error:'Could not start your account session.'}); req.session.userId=String(user._id); req.session.save(se=>{ if(se) return res.status(500).json({error:'Account created, but sign-in failed. Please log in.'}); res.status(201).json({ok:true,user:{id:user._id,name:user.name,email:user.email,role:user.role,coins:user.coins}}); }); });
}));
app.post('/api/login',asyncRoute(async(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase(); const password=String(req.body.password||'');
  const user=await User.findOne({email}); if(!user||!(await bcrypt.compare(password,user.passwordHash))) return res.status(401).json({error:'Incorrect email or password.'});
  req.session.regenerate(err=>{ if(err) return res.status(500).json({error:'Could not create your session.'}); req.session.userId=String(user._id); req.session.save(se=>{ if(se) return res.status(500).json({error:'Could not save your session.'}); res.json({ok:true,user:{id:user._id,name:user.name,email:user.email,role:user.role,coins:user.coins}}); }); });
}));
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',asyncRoute(async(req,res)=>{ if(!req.session?.userId) return res.json({authenticated:false}); const u=await User.findById(req.session.userId).select('-passwordHash'); if(!u) return res.json({authenticated:false}); res.set('Cache-Control','no-store'); res.json({authenticated:true,user:{id:u._id,name:u.name,email:u.email,role:u.role,coins:u.coins}}); }));
app.get('/api/catalogue',requireAuth,(req,res)=>{ res.json({deploymentCost:DEPLOY_COST,bots:Object.entries(config.BOT_REPOSITORIES||{}).map(([id,bot])=>({id,name:bot.name,description:bot.description,repository:bot.repoUrl,branch:bot.branch||'main',pairingUrl:bot.pairingUrl||config.PAIRING_WEBSITE_URL||''}))}); });
app.get('/api/manifest',requireAuth,asyncRoute(async(req,res)=>{ const repoUrl=String(req.query.repoUrl||'').trim(); const branch=String(req.query.branch||'main').trim(); if(!repoUrl) return res.status(400).json({error:'Enter a GitHub repository URL first.'}); const d=await getManifest(repoUrl,branch); res.json({repository:d.info.url,branch:d.info.branch,manifest:d.manifest}); }));
app.get('/api/app-name/suggest',requireAuth,asyncRoute(async(req,res)=>{ const prefix=normalizeAppPrefix(req.query.prefix); for(let a=0;a<12;a++){ const suffix=crypto.randomBytes(3).toString('hex'); const name=`${prefix}-${suffix}`.slice(0,30).replace(/-+$/,''); if(!validateHerokuAppName(name)) continue; if(await Deployment.exists({appName:name,status:{$ne:'deleted'}})) continue; if(await herokuAppNameAvailable(name)) return res.json({available:true,name,prefix:`${prefix}-`,scope:'connected-account'}); } return res.status(503).json({error:'Could not find an available Heroku name right now. Try another prefix.'}); }));
app.get('/api/app-name/check',requireAuth,asyncRoute(async(req,res)=>{ const name=normalizeHerokuAppName(req.query.name); if(!validateHerokuAppName(name)) return res.status(400).json({available:false,error:'Use 3–30 lowercase letters, numbers and hyphens; start with a letter and end with a letter or number.'}); if(await Deployment.exists({appName:name,status:{$ne:'deleted'}})) return res.json({available:false,name,message:'This name is already registered in TEDDY TECH BOT DEPLOYER.'}); const available=await herokuAppNameAvailable(name); return res.json({available,name,message:available?'This name is not present in the connected Heroku account. Heroku will make the final global availability check when deployment starts.':'This name is already taken in the connected Heroku account.'}); }));
async function canAccessDeployment(req,appName){ const q={appName:String(appName).toLowerCase(),status:{$ne:'deleted'}}; if(req.user.role!=='admin') q.userId=req.user._id; const d=await Deployment.findOne(q); if(req.user.role!=='admin'&&!d){ const e=new Error('This application does not belong to your account.'); e.status=403; throw e; } return d; }
app.post('/api/deploy',requireAuth,asyncRoute(async(req,res)=>{
  const name=normalizeHerokuAppName(req.body.name);
  const botId=String(req.body.botId||'').trim();
  const botConfig=(config.BOT_REPOSITORIES||{})[botId];
  if(!botConfig) return res.status(400).json({error:'Select one of the supported bots: TEDDY-XMD, JUNE ULTRA or CYPHERX.'});
  const botName=botConfig.name; const repoUrl=botConfig.repoUrl; const branch=String(botConfig.branch||'main').trim();
  const supplied=req.body.env||{};
  if(!validateHerokuAppName(name)) return res.status(400).json({error:'Heroku app name must be 3–30 characters, start with a letter and end with a letter or number.'});
  if(!supplied||typeof supplied!=='object'||Array.isArray(supplied)) return res.status(400).json({error:'Invalid environment configuration.'});
  const sessionId=String(supplied.SESSION_ID||'').trim();
  if(!sessionId) return res.status(400).json({error:'WhatsApp SESSION_ID is required. Use the Get SESSION_ID link in the dashboard to generate one.'});
  const {info}=await getManifest(repoUrl,branch);
  let overrides = { SESSION_ID: sessionId };
  if(botId === 'teddy-xmd-ultra'){ overrides = buildEnvOverrides(supplied); overrides.SESSION_ID = sessionId; }
  const existing=await Deployment.findOne({appName:name});
  if(existing&&existing.status!=='deleted') return res.status(409).json({error:'That Heroku app name is already registered in the deployer.'});
  if(await herokuAppNameAvailable(name)===false) return res.status(409).json({error:`The Heroku app name "${name}" is already taken. Choose another name or use Suggest available name.`});
  let deployment; const ms=await mongoose.startSession();
  try{ await ms.withTransaction(async()=>{ const user=await User.findOneAndUpdate({_id:req.user._id,coins:{$gte:DEPLOY_COST}},{$inc:{coins:-DEPLOY_COST}},{new:true,session:ms}); if(!user) throw Object.assign(new Error(`You need ${DEPLOY_COST} coins to deploy. Please top up your wallet.`),{status:402});
    if(existing){ existing.userId=req.user._id; existing.botName=botName; existing.repoUrl=info.url; existing.repoOwner=info.owner; existing.repoName=info.repo; existing.branch=info.branch; existing.setupId=null; existing.buildId=null; existing.status='queued'; existing.statusMessage='Waiting for Heroku'; existing.coinsCharged=DEPLOY_COST; existing.refunded=false; existing.deletedAt=null; existing.updatedAt=new Date(); await existing.save({session:ms}); deployment=existing; }
    else{ const docs=await Deployment.create([{userId:req.user._id,appName:name,botName,repoUrl:info.url,repoOwner:info.owner,repoName:info.repo,branch:info.branch,status:'queued',statusMessage:'Waiting for Heroku',coinsCharged:DEPLOY_COST}],{session:ms}); deployment=docs[0]; }
    await WalletTransaction.create([{userId:req.user._id,type:'deployment_charge',delta:-DEPLOY_COST,balanceAfter:user.coins,reference:name,description:`Deployment charge for ${botName} (${name})`}],{session:ms}); }); }finally{ await ms.endSession(); }
  try{
    const setup=await heroku('/app-setups',{method:'POST',body:JSON.stringify({app:{name},source_blob:{url:info.tarball},overrides:{env:overrides}})});
    deployment.setupId=setup.id; deployment.status='building'; deployment.statusMessage='Heroku is preparing the build.'; deployment.updatedAt=new Date(); await deployment.save();
    res.json({ok:true,setup,coinsCharged:DEPLOY_COST,balance:(await User.findById(req.user._id)).coins});
  }catch(e){ await refundDeployment(deployment,e.message); throw e; }
}));
app.get('/api/setups/:id',requireAuth,asyncRoute(async(req,res)=>{
  const deployment=await Deployment.findOne({setupId:req.params.id}); if(!deployment) return res.status(404).json({error:'Deployment setup not found.'});
  if(req.user.role!=='admin'&&String(deployment.userId)!==String(req.user._id)) return res.status(403).json({error:'You cannot view this deployment.'});
  const setup=await heroku(`/app-setups/${encodeURIComponent(req.params.id)}`); let buildResult=null;
  if(setup.app?.name&&setup.build?.id&&setup.build.status==='succeeded'){ try{ buildResult=await heroku(`/apps/${encodeURIComponent(setup.app.name)}/builds/${encodeURIComponent(setup.build.id)}/result`); }catch{} }
  const ss=String(setup.status||'pending').toLowerCase(); const bs=String(setup.build?.status||'').toLowerCase();
  if(['failed','failure','canceled','cancelled','errored'].includes(ss)||['failed','failure','canceled','cancelled','errored'].includes(bs)) await refundDeployment(deployment,setup.failure_message||setup.build?.status||'Heroku build failed');
  else{ deployment.status=['succeeded','success','complete','completed'].includes(ss)?'deploying':'building'; deployment.statusMessage=`Setup: ${ss}; build: ${bs||'waiting'}`; deployment.buildId=setup.build?.id||deployment.buildId; deployment.updatedAt=new Date(); await deployment.save(); }
  res.json({setup,buildResult,deployment:{appName:deployment.appName,status:deployment.status,refunded:deployment.refunded}});
}));
app.get('/api/setups/:id/build-logs',requireAuth,asyncRoute(async(req,res)=>{
  const deployment=await Deployment.findOne({setupId:req.params.id}); if(!deployment) return res.status(404).type('text/plain').send('Deployment not found.');
  if(req.user.role!=='admin'&&String(deployment.userId)!==String(req.user._id)) return res.status(403).type('text/plain').send('Access denied.');
  const setup=await heroku(`/app-setups/${encodeURIComponent(req.params.id)}`); const streamUrl=setup.build?.output_stream_url;
  if(!streamUrl) return res.status(202).type('text/plain').send('Waiting for Heroku to start the build and publish its logs…\n');
  const parsed=new URL(streamUrl); if(parsed.protocol!=='https:'||parsed.hostname!=='build-output.heroku.com') return res.status(502).type('text/plain').send('Heroku returned an unexpected build log address.');
  const controller=new AbortController(); res.on('close',()=>controller.abort());
  const upstream=await fetch(parsed.toString(),{headers:{Accept:'text/plain'},signal:controller.signal}); if(!upstream.ok) throw Object.assign(new Error(`Heroku build log stream returned ${upstream.status}.`),{status:502});
  res.status(200); res.setHeader('Content-Type','text/plain; charset=utf-8'); res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
  if(!upstream.body) return res.end(); const reader=upstream.body.getReader();
  while(true){ const {done,value}=await reader.read(); if(done||res.destroyed) break; if(!res.write(Buffer.from(value))) await new Promise(r=>res.once('drain',r)); } if(!res.destroyed) res.end();
}));
async function herokuAppSummary(appData,deployment){
  try{
    const [dynos,formation]=await Promise.all([heroku(`/apps/${encodeURIComponent(appData.name)}/dynos`),heroku(`/apps/${encodeURIComponent(appData.name)}/formation`)]);
    const webDynos=dynos.filter(d=>d.type==='web'); const running=webDynos.filter(d=>d.state==='up').length; const starting=webDynos.some(d=>['starting','restarting'].includes(d.state)); const crashed=webDynos.some(d=>d.state==='crashed');
    const webFormation=formation.find(f=>f.type==='web'); const desired=webFormation?Number(webFormation.quantity||0):0;
    let status=appData.maintenance?'maintenance':running>0?'running':starting?'starting':crashed?'offline':desired===0?'scaled-down':'offline';
    if(deployment&&running===0&&!crashed&&!appData.maintenance&&['queued','building','deploying'].includes(deployment.status)) status=deployment.status==='queued'?'building':deployment.status;
    if(deployment?.status==='failed') status='failed';
    if(running>0&&deployment&&deployment.status!=='running'){ deployment.status='running'; deployment.statusMessage='Web dyno is running.'; deployment.updatedAt=new Date(); await deployment.save(); }
    else if(crashed&&deployment&&deployment.status!=='failed'&&deployment.status!=='offline'){ deployment.status='offline'; deployment.statusMessage='The web dyno crashed after deployment.'; deployment.updatedAt=new Date(); await deployment.save(); }
    return {id:appData.id,name:appData.name,web_url:appData.web_url,created_at:appData.created_at,updated_at:appData.updated_at,region:appData.region?.name||null,stack:appData.stack?.name||null,maintenance:appData.maintenance,status,status_reason:deployment?.status==='failed'?(deployment.statusMessage||'Deployment failed; coins refunded.'):crashed?'The web dyno crashed.':null,running_dynos:running,total_web_dynos:webDynos.length,desired_web_dynos:desired,owner_email:deployment?.ownerEmail||undefined,bot_name:deployment?.botName||undefined,repo_url:deployment?.repoUrl||undefined,setup_id:deployment?.setupId||undefined,build_id:deployment?.buildId||undefined,deployment_status:deployment?.status||undefined,refunded:deployment?.refunded||false};
  }catch(e){ return {id:appData.id,name:appData.name,web_url:appData.web_url,status:'unknown',error:e.message,owner_email:deployment?.ownerEmail||undefined}; }
}
app.get('/api/apps',requireAuth,asyncRoute(async(req,res)=>{
  let appRecords=[]; let deployments;
  if(req.user.role==='admin'){ const all=await heroku('/apps'); deployments=await Deployment.find({status:{$ne:'deleted'}}).populate('userId','email name'); const map=new Map(deployments.map(d=>[d.appName,d])); appRecords=all.map(a=>({app:a,deployment:map.get(a.name)||null})); }
  else{ deployments=await Deployment.find({userId:req.user._id,status:{$ne:'deleted'}}).populate('userId','email name').sort({createdAt:-1}); for(const d of deployments){ try{ const ad=await heroku(`/apps/${encodeURIComponent(d.appName)}`); appRecords.push({app:ad,deployment:d}); }catch(e){ if(e.status===404) appRecords.push({app:{id:d.appName,name:d.appName,web_url:null},deployment:d,missing:true}); else throw e; } } }
  const results=await Promise.all(appRecords.map(async({app:appData,deployment,missing})=>{
    if(deployment){ deployment.ownerEmail=deployment.userId?.email;
      if(deployment.setupId&&['queued','building','deploying'].includes(deployment.status)){ try{ const s=await heroku(`/app-setups/${encodeURIComponent(deployment.setupId)}`); const ss=String(s.status||'').toLowerCase(); const bb=String(s.build?.status||'').toLowerCase(); if(['failed','failure','canceled','cancelled','errored'].includes(ss)||['failed','failure','canceled','cancelled','errored'].includes(bb)) await refundDeployment(deployment,s.failure_message||'Heroku build failed'); else if(['succeeded','success','complete','completed'].includes(ss)){ deployment.status='deploying'; deployment.buildId=s.build?.id||deployment.buildId; await deployment.save(); } }catch(e){ console.warn('Setup refresh failed:',e.message); } }
      else if(deployment.buildId&&deployment.status==='building'){ try{ const b=await heroku(`/apps/${encodeURIComponent(deployment.appName)}/builds/${encodeURIComponent(deployment.buildId)}`); const bs=String(b.status||'').toLowerCase(); if(['failed','failure','canceled','cancelled','errored'].includes(bs)) await refundDeployment(deployment,b.error_message||'Heroku build failed'); else if(['succeeded','success'].includes(bs)){ deployment.status='deploying'; deployment.statusMessage='Build completed; waiting for the web dyno.'; deployment.updatedAt=new Date(); await deployment.save(); } }catch(e){ console.warn('Build refresh failed:',e.message); } }
    }
    if(missing) return {id:appData.id,name:appData.name,web_url:null,status:deployment?.status==='failed'?'failed':'offline',status_reason:deployment?.statusMessage||'This app was not found in Heroku.',bot_name:deployment?.botName,setup_id:deployment?.setupId,build_id:deployment?.buildId};
    return herokuAppSummary(appData,deployment);
  }));
  res.set('Cache-Control','no-store'); res.json(results);
}));
app.get('/api/deployments',requireAuth,asyncRoute(async(req,res)=>{ const q=req.user.role==='admin'?{}:{userId:req.user._id}; const list=await Deployment.find(q).populate('userId','name email').sort({createdAt:-1}).limit(200); res.json(list.map(d=>({id:d._id,user:d.userId?{name:d.userId.name,email:d.userId.email}:null,appName:d.appName,botName:d.botName,repoUrl:d.repoUrl,branch:d.branch,setupId:d.setupId,buildId:d.buildId,status:d.status,statusMessage:d.statusMessage,coinsCharged:d.coinsCharged,refunded:d.refunded,createdAt:d.createdAt}))); }));
app.get('/api/apps/:name',requireAuth,asyncRoute(async(req,res)=>{ await canAccessDeployment(req,req.params.name); const name=encodeURIComponent(req.params.name); const [details,formation,configVars]=await Promise.all([heroku(`/apps/${name}`),heroku(`/apps/${name}/formation`),heroku(`/apps/${name}/config-vars`)]); for(const k of ['HEROKU_API_KEY','PAYSTACK_SECRET_KEY','MONGODB_URI','SESSION_SECRET']) delete configVars[k]; res.set('Cache-Control','no-store'); res.json({details,formation,configVars}); }));
app.post('/api/apps/:name/restart',requireAuth,asyncRoute(async(req,res)=>{ const n=req.params.name; await canAccessDeployment(req,n); if((config.PROTECTED_APP_NAMES||[]).includes(n)) return res.status(403).json({error:'This app is protected.'}); await heroku(`/apps/${encodeURIComponent(n)}/dynos`,{method:'DELETE'}); res.json({ok:true,message:'Restart requested.'}); }));
app.put('/api/apps/:name/config-vars',requireAuth,asyncRoute(async(req,res)=>{
  const nameRaw=req.params.name; await canAccessDeployment(req,nameRaw); if((config.PROTECTED_APP_NAMES||[]).includes(nameRaw)) return res.status(403).json({error:'This app is protected.'});
  const vars=req.body&&req.body.vars; if(!vars||typeof vars!=='object'||Array.isArray(vars)) return res.status(400).json({error:'Send vars as a JSON object of KEY: VALUE pairs. Use null to remove a key.'});
  const patch={}; const prot=new Set(['HEROKU_API_KEY','PAYSTACK_SECRET_KEY','MONGODB_URI','SESSION_SECRET']);
  for(const [k,v] of Object.entries(vars)){ if(prot.has(k)) return res.status(403).json({error:`${k} is managed securely by Teddy Tech and cannot be viewed or edited here.`}); if(!/^[A-Z][A-Z0-9_]{0,99}$/.test(k)) return res.status(400).json({error:`Invalid environment variable name: ${k}`}); if(v!==null&&typeof v!=='string'&&typeof v!=='number'&&typeof v!=='boolean') return res.status(400).json({error:`Value for ${k} must be text, a number, boolean, or null.`}); patch[k]=v===null?null:String(v); }
  if(!Object.keys(patch).length) return res.status(400).json({error:'Enter at least one environment variable to update.'});
  const updated=await heroku(`/apps/${encodeURIComponent(nameRaw)}/config-vars`,{method:'PATCH',body:JSON.stringify(patch)}); res.set('Cache-Control','no-store'); res.json({ok:true,configVars:updated,message:'Environment variables updated successfully.'});
}));
app.delete('/api/apps/:name',requireAuth,asyncRoute(async(req,res)=>{ const n=req.params.name; const d=await canAccessDeployment(req,n); if((config.PROTECTED_APP_NAMES||[]).includes(n)) return res.status(403).json({error:'This app is protected.'}); if(String(req.body.confirm||'')!==n) return res.status(400).json({error:'Confirmation does not match app name.'}); await heroku(`/apps/${encodeURIComponent(n)}`,{method:'DELETE'}); if(d){ d.status='deleted'; d.deletedAt=new Date(); d.updatedAt=new Date(); await d.save(); } res.json({ok:true}); }));
app.get('/api/apps/:name/build-logs/:buildId',requireAuth,asyncRoute(async(req,res)=>{
  await canAccessDeployment(req,req.params.name); const build=await heroku(`/apps/${encodeURIComponent(req.params.name)}/builds/${encodeURIComponent(req.params.buildId)}`); const streamUrl=build.output_stream_url;
  if(!streamUrl) return res.status(202).type('text/plain').send('Waiting for Heroku to publish this build log stream…\n'); const parsed=new URL(streamUrl); if(parsed.protocol!=='https:'||parsed.hostname!=='build-output.heroku.com') return res.status(502).type('text/plain').send('Heroku returned an unexpected build log address.');
  const c=new AbortController(); res.on('close',()=>c.abort()); const up=await fetch(parsed.toString(),{headers:{Accept:'text/plain'},signal:c.signal}); if(!up.ok) throw Object.assign(new Error(`Heroku build log stream returned ${up.status}.`),{status:502});
  res.status(200); res.setHeader('Content-Type','text/plain; charset=utf-8'); res.setHeader('Cache-Control','no-store'); if(!up.body) return res.end(); const reader=up.body.getReader(); while(true){ const {done,value}=await reader.read(); if(done||res.destroyed) break; if(!res.write(Buffer.from(value))) await new Promise(r=>res.once('drain',r)); } if(!res.destroyed) res.end();
}));
app.get('/api/apps/:name/logs',requireAuth,asyncRoute(async(req,res)=>{ await canAccessDeployment(req,req.params.name); const name=encodeURIComponent(req.params.name); const ls=await heroku(`/apps/${name}/log-sessions`,{method:'POST',body:JSON.stringify({lines:200,source:'app',dyno:null,tail:false})}); if(!ls.logplex_url) return res.status(502).json({error:'Heroku did not return a log URL.'}); const r=await fetch(ls.logplex_url,{headers:{Accept:'text/plain'}}); if(!r.ok) throw Object.assign(new Error(`Log retrieval failed: ${r.status}`),{status:502}); res.type('text/plain').send(await r.text()); }));
app.post('/api/payments/initialize',requireAuth,asyncRoute(async(req,res)=>{
  const coins=Number(req.body.coins); const currency=String(req.body.currency||'KES').toUpperCase();
  if(!Number.isInteger(coins)||coins<10||coins%10!==0||coins>100000) return res.status(400).json({error:'Choose a coin amount in multiples of 10 (minimum 10 coins).'});
  if(!['KES','USD'].includes(currency)) return res.status(400).json({error:'Choose KES or USD.'});
  const packs=coins/10; let amountMinor; if(currency==='KES') amountMinor=Math.round(packs*KES_PER_10_COINS*100); else{ amountMinor=Math.round(packs*USD_PER_10_COINS*100); if(amountMinor<Math.round(USD_MINIMUM*100)) return res.status(400).json({error:`Paystack USD checkout minimum is $${USD_MINIMUM.toFixed(2)}. Choose at least ${Math.ceil(USD_MINIMUM/USD_PER_10_COINS)*10} coins for USD, or pay in KES to buy 10 coins.`}); }
  const reference=`Teddy${Date.now()}${crypto.randomBytes(5).toString('hex')}`; const payment=await Payment.create({userId:req.user._id,reference,coins,amountMinor,currency,provider:'paystack',status:'pending'}); const cb=`${getPublicBase(req)}/api/payments/callback`;
  try{ const data=await paystackRequest('/transaction/initialize',{method:'POST',body:JSON.stringify({email:req.user.email,amount:amountMinor,currency,reference,callback_url:cb,channels:currency==='USD'?['card']:['card','mobile_money','bank_transfer'],metadata:{user_id:String(req.user._id),coins,currency}})}); payment.authorizationUrl=data.authorization_url; await payment.save(); res.json({ok:true,authorizationUrl:data.authorization_url,reference,coins,amountMinor,currency}); }catch(e){ payment.status='initialization_failed'; await payment.save(); throw e; }
}));
app.get('/api/payments/callback',asyncRoute(async(req,res)=>{ const ref=String(req.query.reference||req.query.trxref||''); if(!ref) return res.redirect('/?payment=missing'); try{ const p=await verifyPaystackReference(ref); return res.redirect(p.credited?'/?payment=success':'/?payment=pending'); }catch(e){ console.error('Paystack callback verification failed:',e.message); return res.redirect('/?payment=failed'); } }));
app.post('/api/payments/webhook',asyncRoute(async(req,res)=>{
  if(!config.PAYSTACK_SECRET_KEY) return res.sendStatus(503); const sig=String(req.headers['x-paystack-signature']||''); const raw=req.rawBody||Buffer.from(JSON.stringify(req.body||{})); const exp=crypto.createHmac('sha512',config.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  const a=Buffer.from(sig); const b=Buffer.from(exp); if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) return res.sendStatus(401);
  let ev; try{ ev=req.body; if(!ev||typeof ev!=='object') ev=JSON.parse(raw.toString('utf8')); }catch{ return res.sendStatus(400); }
  if(ev.event==='charge.success'&&ev.data?.reference){ try{ await verifyPaystackReference(ev.data.reference); }catch(e){ console.warn('Paystack webhook fulfillment deferred:',e.message); } }
  res.sendStatus(200);
}));


// ================= M-PESA MANUAL PAYMENT =================
app.post('/api/mpesa-manual/initialize', requireAuth, asyncRoute(async(req,res)=>{
  const coins = Number(req.body.coins);
  const country = String(req.body.country || '').trim().slice(0,60);
  if(!Number.isInteger(coins) || coins < 10 || coins % 10 !== 0 || coins > 100000)
    return res.status(400).json({error:'Choose coins in multiples of 10 (minimum 10).'});
  if(!country) return res.status(400).json({error:'Select your country.'});
  const amountMinor = Math.round((coins / 10) * KES_PER_10_COINS * 100);
  const reference = `THP-MP-${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  await Payment.create({userId:req.user._id,reference,coins,amountMinor,currency:'KES',provider:'mpesa-manual',status:'pending_receipt',country});
  res.json({ok:true,reference,coins,amountKes:(amountMinor/100).toFixed(2),currency:'KES',country,phone:MPESA_RECEIVER_PHONE,accountName:MPESA_RECEIVER_NAME,status:'pending_receipt'});
}));
app.get('/api/mpesa-manual/order/:reference', requireAuth, asyncRoute(async(req,res)=>{
  const p = await Payment.findOne({reference:req.params.reference,userId:req.user._id,provider:'mpesa-manual'});
  if(!p) return res.status(404).json({error:'Payment not found.'});
  const user = await User.findById(req.user._id).select('coins');
  res.json({ok:true,reference:p.reference,coins:p.coins,amountKes:(p.amountMinor/100).toFixed(2),status:p.status,credited:p.credited,adminNote:p.adminNote||'',currentBalance:user?.coins||0});
}));
app.post('/api/mpesa-manual/upload-receipt', requireAuth, asyncRoute(async(req,res)=>{
  const {reference,receiptImage,customerPaymentRef} = req.body;
  if(!reference || !receiptImage || !String(receiptImage).startsWith('data:image/')) return res.status(400).json({error:'Payment screenshot is required.'});
  if(receiptImage.length > 8*1024*1024) return res.status(413).json({error:'Screenshot is too large. Please upload an image under 6 MB.'});
  const p = await Payment.findOne({reference,userId:req.user._id,provider:'mpesa-manual'});
  if(!p) return res.status(404).json({error:'Payment not found.'});
  if(p.credited) return res.status(400).json({error:'This payment was already credited.'});
  if(p.status === 'awaiting_verification') return res.status(400).json({error:'Receipt already sent. Pending approval.'});
  if(!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) return res.status(503).json({error:'Telegram notifications are not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID.'});
  p.receiptImage=receiptImage; p.customerPaymentRef=String(customerPaymentRef||'').trim().slice(0,100); p.receiptUploadedAt=new Date(); p.status='awaiting_verification'; p.adminNote='';
  await p.save();
  try{
    const user=await User.findById(req.user._id).select('name email');
    await sendMpesaReceiptToTelegram(p,user);
  }catch(e){p.status='pending_receipt';await p.save();return res.status(502).json({error:`Screenshot saved but Telegram notification failed: ${e.message}`});}
  res.json({ok:true,message:'M-Pesa screenshot sent. Pending manual verification.',status:p.status});
}));

// ================= BINANCE PAY MANUAL =================
app.post('/api/binance-pay/initialize', requireAuth, asyncRoute(async(req,res)=>{
  const coins = Number(req.body.coins);
  if(!Number.isInteger(coins) || coins < 10 || coins % 10 !== 0 || coins > 100000)
    return res.status(400).json({error:'Choose coins in multiples of 10 (minimum 10).'});
  if(!isBinancePayConfigured())
    return res.status(503).json({error:'Binance Pay is not configured yet. Set BINANCE_PAY_UID and BINANCE_PAY_EMAIL.'});
  const packs = coins / 10;
  const amountMinor = Math.round(packs * USD_PER_10_COINS * 100);
  const usdAmount = (amountMinor/100).toFixed(2);
  const reference = `THP-BN-${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  await Payment.create({ userId:req.user._id, reference, coins, amountMinor, currency:'BINANCE_USD', provider:'binance-pay', status:'pending_receipt', binanceUid:BINANCE_PAY_UID, binanceEmail:BINANCE_PAY_EMAIL });
  res.json({ok:true, reference, coins, amountMinor, usdAmount, currency:'USDT', binanceUid:BINANCE_PAY_UID, binanceEmail:BINANCE_PAY_EMAIL, status:'pending_receipt'});
}));
app.get('/api/binance-pay/order/:reference', requireAuth, asyncRoute(async(req,res)=>{
  const p = await Payment.findOne({reference:req.params.reference, userId:req.user._id});
  if(!p) return res.status(404).json({error:'Payment not found.'});
  const user = await User.findById(req.user._id).select('coins');
  res.json({ok:true, reference:p.reference, coins:p.coins, usdAmount:(p.amountMinor/100).toFixed(2), binanceUid:p.binanceUid || BINANCE_PAY_UID, binanceEmail:p.binanceEmail || BINANCE_PAY_EMAIL, status:p.status, credited:p.credited, adminNote:p.adminNote || '', currentBalance:user?.coins || 0});
}));
app.post('/api/binance-pay/upload-receipt', requireAuth, asyncRoute(async(req,res)=>{
  const {reference, receiptImage} = req.body;
  if(!reference || !receiptImage) return res.status(400).json({error:'Reference and receipt screenshot are required.'});
  const p = await Payment.findOne({reference, userId:req.user._id});
  if(!p) return res.status(404).json({error:'Payment not found.'});
  if(p.credited) return res.status(400).json({error:'This payment was already credited.'});
  if(p.status === 'awaiting_verification') return res.status(400).json({error:'Receipt already sent. Pending - Waiting for Approval.'});
  if(!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) return res.status(503).json({error:'Telegram notifications are not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID in Heroku Config Vars.'});
  p.receiptImage = receiptImage; p.receiptUploadedAt = new Date(); p.status = 'awaiting_verification'; p.adminNote = '';
  await p.save();
  try{
    const user = await User.findById(req.user._id).select('name email');
    await sendBinanceReceiptToTelegram(p, user);
  }catch(e){
    p.status='pending_receipt'; await p.save();
    return res.status(502).json({error:`Receipt saved but Telegram could not be notified: ${e.message}. Check the Telegram bot token, admin chat ID and bot permissions, then try again.`});
  }
  res.json({ok:true, message:'Receipt sent to Telegram. Pending - Waiting for Approval.', status:p.status});
}));
async function notifySupportTicket(ticket,user){
  if(!TELEGRAM_BOT_TOKEN||!TELEGRAM_ADMIN_CHAT_ID)return;
  const escHtml=v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const msg=ticket.messages[ticket.messages.length-1];
  await sendTelegramMessage(TELEGRAM_ADMIN_CHAT_ID,`🎫 <b>Support ticket ${escHtml(ticket.ticketNumber)}</b>\nSubject: ${escHtml(ticket.subject)}\nUser: ${escHtml(user.name)} (${escHtml(user.email)})\n\n${escHtml(msg?.body)}\n\nReply to this message in Telegram, or send:\n<code>/reply ${escHtml(ticket.ticketNumber)} Your message</code>`);
}
app.post('/api/telegram/webhook', asyncRoute(async(req,res)=>{
  const allowedAdminChatId = String(TELEGRAM_ADMIN_CHAT_ID||'');
  const incoming=req.body?.message;
  if(incoming?.text){
    if(!allowedAdminChatId||String(incoming.chat?.id)!==allowedAdminChatId)return res.sendStatus(200);
    const raw=String(incoming.text).trim(); let ticketNumber='',replyText='';
    const cmd=raw.match(/^\/reply\s+(TKT-\d{8})\s+([\s\S]+)$/i);
    if(cmd){ticketNumber=cmd[1].toUpperCase();replyText=cmd[2].trim();}
    else if(incoming.reply_to_message?.text){const m=String(incoming.reply_to_message.text).match(/support ticket (TKT-\d{8})/i);if(m){ticketNumber=m[1].toUpperCase();replyText=raw;}}
    if(ticketNumber&&replyText){const t=await SupportTicket.findOne({ticketNumber});if(t&&t.status!=='closed'){t.messages.push({sender:'admin',body:replyText.slice(0,4000)});t.status='waiting_user';t.updatedAt=new Date();await t.save();await sendTelegramMessage(TELEGRAM_ADMIN_CHAT_ID,`✅ Reply delivered to ${ticketNumber}.`);}}
    return res.sendStatus(200);
  }
  const cb = req.body?.callback_query;
  if(!cb || !cb.data) return res.sendStatus(200);
  const callbackAdminChatId = String(TELEGRAM_ADMIN_CHAT_ID||'');
  if(!callbackAdminChatId || String(cb.message?.chat?.id) !== callbackAdminChatId){
    await telegramApi('answerCallbackQuery',{callback_query_id:cb.id,text:'You are not authorized to approve payments.'}).catch(()=>{});
    return res.sendStatus(200);
  }
  const [action, reference] = String(cb.data).split(':');
  if(!['bn_approve','bn_reject','mp_approve','mp_reject'].includes(action) || !reference) return res.sendStatus(200);
  // Acknowledge immediately so Telegram does not leave the button spinning.
  await telegramApi('answerCallbackQuery',{callback_query_id:cb.id,text:action.endsWith('_approve')?'Processing approval…':'Processing rejection…'}).catch(()=>{});
  res.sendStatus(200);
  try{
    const payment = await Payment.findOne({reference});
    if(!payment || !(['bn_approve','bn_reject'].includes(action) ? payment.provider==='binance-pay' : payment.provider==='mpesa-manual')) return;
    if(action === 'bn_approve' || action === 'mp_approve'){
      if(payment.credited) return;
      await creditPaymentByReference(reference, payment.provider==='mpesa-manual' ? 'M-Pesa (Manual)' : 'Binance Pay (Telegram Manual)');
      const u = await User.findById(payment.userId).select('coins');
      await sendTelegramMessage(TELEGRAM_ADMIN_CHAT_ID, `✅ Approved <code>${reference}</code> - ${payment.coins} coins added. New balance: ${u?.coins}`);
      await telegramApi('editMessageReplyMarkup',{chat_id:cb.message.chat.id,message_id:cb.message.message_id,reply_markup:{inline_keyboard:[[{text:'✅ APPROVED',callback_data:'done'}]]}}).catch(()=>{});
    } else {
      if(payment.credited) return;
      payment.status = 'rejected'; payment.adminNote = 'Receipt not valid. Send correct payment and upload again.'; await payment.save();
      await sendTelegramMessage(TELEGRAM_ADMIN_CHAT_ID, `❌ Rejected <code>${reference}</code>`);
      await telegramApi('editMessageReplyMarkup',{chat_id:cb.message.chat.id,message_id:cb.message.message_id,reply_markup:{inline_keyboard:[[{text:'❌ REJECTED',callback_data:'done'}]]}}).catch(()=>{});
    }
  }catch(e){ console.error('Telegram webhook processing error:', e.message); }
}));
app.post('/api/binance-pay/webhook', asyncRoute(async(req,res)=>{ return res.json({ok:true, message:'Binance Pay is manual. Use Telegram approve.'}); }));
app.get('/api/binance-pay/callback', asyncRoute(async(req,res)=>{ return res.redirect('/?payment=pending&provider=binance-pay'); }));
// Admin backup approve - also never expires
app.post('/api/admin/binance-pay/:reference/approve', requireAuth, requireAdmin, asyncRoute(async(req,res)=>{
  const p = await Payment.findOne({reference:req.params.reference});
  if(!p) return res.status(404).json({error:'Payment not found.'});
  if(p.credited) return res.status(400).json({error:'Already credited.'});
  await creditPaymentByReference(p.reference, 'Binance Pay (Manual)');
  res.json({ok:true, message:`Approved. ${p.coins} coins added.`});
}));
app.post('/api/admin/binance-pay/:reference/reject', requireAuth, requireAdmin, asyncRoute(async(req,res)=>{
  const p = await Payment.findOne({reference:req.params.reference});
  if(!p) return res.status(404).json({error:'Payment not found.'});
  if(p.credited) return res.status(400).json({error:'Already credited.'});
  p.status='rejected'; p.adminNote=String(req.body.note||'Receipt not valid.'); await p.save();
  res.json({ok:true, message:'Rejected.'});
}));

app.get('/api/wallet',requireAuth,asyncRoute(async(req,res)=>{ const [user,transactions,payments]=await Promise.all([User.findById(req.user._id).select('coins'),WalletTransaction.find({userId:req.user._id}).sort({createdAt:-1}).limit(50),Payment.find({userId:req.user._id}).sort({createdAt:-1}).limit(20).select('-authorizationUrl')]); res.json({coins:user.coins,transactions,payments,pricing:{kesPer10Coins:KES_PER_10_COINS,usdPer10Coins:USD_PER_10_COINS,usdMinimum:USD_MINIMUM,usdMinimumCoins:Math.ceil(USD_MINIMUM/USD_PER_10_COINS)*10},binancePay:{enabled:BINANCE_PAY_ENABLED,comingSoon:BINANCE_PAY_COMING_SOON,configured:isBinancePayConfigured(),usdPer10Coins:USD_PER_10_COINS}}); }));

// Dedicated, role-scoped support APIs. Customer queries are always pinned to req.user._id.
app.get('/api/admin/support/conversations',requireAuth,requireAdmin,asyncRoute(async(req,res)=>{
 const q={}; const status=String(req.query.status||'').trim();
 if(['open','pending','resolved'].includes(status)) q.status=status==='pending'?'waiting_user':status==='resolved'?'closed':'open';
 const rows=await SupportTicket.find(q).sort({updatedAt:-1}).limit(500).populate('userId','name email');
 res.json(rows.map(t=>{const o=t.toObject();o.unreadCount=(t.messages||[]).filter(m=>m.sender==='user'&&!m.readByAdmin).length;o.status=o.status==='closed'?'resolved':o.status==='waiting_user'?'pending':o.status;return o;}));
}));
app.get('/api/admin/support/conversations/:id',requireAuth,requireAdmin,asyncRoute(async(req,res)=>{
 const t=await SupportTicket.findById(req.params.id).populate('userId','name email');if(!t)return res.status(404).json({error:'Conversation not found.'});
 t.messages.forEach(m=>{if(m.sender==='user')m.readByAdmin=true;});await t.save();res.json(t);
}));
app.post('/api/admin/support/conversations/:id/reply',requireAuth,requireAdmin,asyncRoute(async(req,res)=>{
 const body=String(req.body.message||'').trim(),clientMessageId=String(req.body.clientMessageId||'').trim();if(!body||body.length>4000)return res.status(400).json({error:'Reply must contain 1–4000 characters.'});
 if(!/^[A-Za-z0-9_-]{8,100}$/.test(clientMessageId))return res.status(400).json({error:'A valid message submission ID is required.'});
 const t=await SupportTicket.findById(req.params.id);if(!t)return res.status(404).json({error:'Conversation not found.'});
 if(t.messages.some(m=>m.clientMessageId===clientMessageId))return res.json({ok:true,duplicate:true,ticket:t});
 t.messages.push({sender:'admin',body,clientMessageId,readByCustomer:false});t.status='waiting_user';t.updatedAt=new Date();await t.save();res.status(201).json({ok:true,ticket:t});
}));
app.patch('/api/admin/support/conversations/:id/status',requireAuth,requireAdmin,asyncRoute(async(req,res)=>{
 const status=String(req.body.status||'');const map={open:'open',pending:'waiting_user',resolved:'closed'};if(!map[status])return res.status(400).json({error:'Status must be open, pending, or resolved.'});
 const t=await SupportTicket.findByIdAndUpdate(req.params.id,{status:map[status],updatedAt:new Date()},{new:true});if(!t)return res.status(404).json({error:'Conversation not found.'});res.json({ok:true,ticket:t});
}));
app.get('/api/support/conversations',requireAuth,asyncRoute(async(req,res)=>{
 const rows=await SupportTicket.find({userId:req.user._id}).sort({updatedAt:-1}).limit(100);
 for(const t of rows){let changed=false;t.messages.forEach(m=>{if(m.sender==='admin'&&!m.readByCustomer){m.readByCustomer=true;changed=true;}});if(changed)await t.save();}
 res.json(rows);
}));
app.get('/api/support/tickets',requireAuth,asyncRoute(async(req,res)=>{const q=req.user.role==='admin'?{}:{userId:req.user._id};const rows=await SupportTicket.find(q).sort({updatedAt:-1}).limit(100).populate('userId','name email');res.json(rows);}));
app.post('/api/support/tickets',requireAuth,asyncRoute(async(req,res)=>{
 const subject=String(req.body.subject||'Support request').trim().slice(0,120),body=String(req.body.message||'').trim().slice(0,4000);
 if(!body)return res.status(400).json({error:'Write a message before submitting.'});
 const ticketNumber='TKT-'+String(Date.now()).slice(-8);
 const welcome='Hello, this is TEDDY-XMD assistant. How can I help you?';
 const ticket=await SupportTicket.create({ticketNumber,userId:req.user._id,subject,messages:[{sender:'system',body:welcome},{sender:'user',body}]});
 try{await notifySupportTicket(ticket,req.user);}catch(e){console.error('Support Telegram notification failed:',e.message);}
 res.status(201).json({ok:true,ticket});
}));
app.post('/api/support/tickets/:id/replies',requireAuth,asyncRoute(async(req,res)=>{
 const body=String(req.body.message||'').trim().slice(0,4000);if(!body)return res.status(400).json({error:'Reply cannot be empty.'});
 const ticket=await SupportTicket.findById(req.params.id);if(!ticket)return res.status(404).json({error:'Ticket not found.'});
 if(req.user.role!=='admin'&&String(ticket.userId)!==String(req.user._id))return res.status(403).json({error:'You cannot access this ticket.'});
 if(ticket.status==='closed'&&req.user.role!=='admin')return res.status(400).json({error:'This ticket is closed.'});
 ticket.messages.push({sender:req.user.role==='admin'?'admin':'user',body});ticket.status=req.user.role==='admin'?'waiting_user':'open';ticket.updatedAt=new Date();await ticket.save();if(req.user.role!=='admin'){try{await notifySupportTicket(ticket,req.user);}catch(e){console.error('Support Telegram notification failed:',e.message);}}res.json({ok:true,ticket});
}));
app.patch('/api/support/tickets/:id/status',requireAuth,requireAdmin,asyncRoute(async(req,res)=>{let status=String(req.body.status||'');if(status==='pending')status='waiting_user';if(status==='resolved')status='closed';if(!['open','waiting_user','closed'].includes(status))return res.status(400).json({error:'Invalid ticket status.'});const ticket=await SupportTicket.findByIdAndUpdate(req.params.id,{status,updatedAt:new Date()},{new:true});if(!ticket)return res.status(404).json({error:'Ticket not found.'});res.json({ok:true,ticket});}));

// Continuous support chat: reuse the customer's latest non-resolved conversation.
app.post('/api/support/chat/message',requireAuth,asyncRoute(async(req,res)=>{
 const body=String(req.body.message||'').trim(),clientMessageId=String(req.body.clientMessageId||'').trim();
 if(!body||body.length>4000)return res.status(400).json({error:'Message must contain 1–4000 characters.'});
 if(!/^[A-Za-z0-9_-]{8,100}$/.test(clientMessageId))return res.status(400).json({error:'A valid message submission ID is required.'});
 let ticket=await SupportTicket.findOne({userId:req.user._id,status:{$ne:'closed'}}).sort({updatedAt:-1});
 if(!ticket){
  ticket=await SupportTicket.create({ticketNumber:'TKT-'+String(Date.now()).slice(-8)+'-'+crypto.randomBytes(2).toString('hex').toUpperCase(),userId:req.user._id,subject:'Website support chat',messages:[{sender:'system',body:'Hello, this is TEDDY-XMD assistant. How can I help you?'}]});
 }
 if(ticket.messages.some(m=>m.clientMessageId===clientMessageId))return res.json({ok:true,duplicate:true,ticket});
 ticket.messages.push({sender:'user',body,clientMessageId});ticket.status='open';ticket.updatedAt=new Date();await ticket.save();
 try{await notifySupportTicket(ticket,req.user);}catch(e){console.error('Support Telegram notification failed:',e.message);}
 res.status(201).json({ok:true,ticket});
}));
app.post('/api/admin/support/broadcast',requireAuth,requireAdmin,asyncRoute(async(req,res)=>{
 const message=String(req.body.message||'').trim(),broadcastId=String(req.body.broadcastId||'').trim();
 if(!message||message.length>4000)return res.status(400).json({error:'Message must contain 1–4000 characters.'});
 if(!/^[A-Za-z0-9_-]{8,100}$/.test(broadcastId))return res.status(400).json({error:'A valid broadcast ID is required.'});
 if(await SupportTicket.exists({'messages.broadcastId':broadcastId}))return res.status(409).json({error:'This broadcast was already sent.'});
 const users=await User.find({role:'user'}).select('_id');let sent=0,failed=[];
 for(const user of users){try{
  let t=await SupportTicket.findOne({userId:user._id}).sort({updatedAt:-1});
  if(!t)t=await SupportTicket.create({ticketNumber:'TKT-'+Date.now().toString().slice(-8)+'-'+crypto.randomBytes(3).toString('hex').toUpperCase(),userId:user._id,subject:'TEDDY-XMD announcement',messages:[]});
  t.messages.push({sender:'admin',body:message,broadcastId,readByCustomer:false});t.status='waiting_user';t.updatedAt=new Date();await t.save();sent++;
 }catch(e){failed.push({userId:String(user._id),error:e.message});}}
 res.json({ok:failed.length===0,sent,failed,broadcastId,total:users.length});
}));
app.get('/api/admin/summary',requireAuth,requireAdmin,asyncRoute(async(req,res)=>{ const [users,deployments,payments,coins]=await Promise.all([User.countDocuments({role:'user'}),Deployment.countDocuments({status:{$ne:'deleted'}}),Payment.countDocuments({status:'success'}),User.aggregate([{$group:{_id:null,total:{$sum:'$coins'}}}])]); res.json({users,deployments,successfulPayments:payments,coinsInWallets:coins[0]?.total||0}); }));
app.get('/api/admin/users',requireAuth,requireAdmin,asyncRoute(async(req,res)=>{ const users=await User.find({role:'user'}).select('-passwordHash').sort({createdAt:-1}).limit(500); res.json(users); }));
app.post('/api/admin/users/:id/coins',requireAuth,requireAdmin,asyncRoute(async(req,res)=>{
  const delta=Number(req.body.delta); const reason=String(req.body.reason||'Admin wallet adjustment').trim().slice(0,200);
  if(!Number.isInteger(delta)||delta===0||Math.abs(delta)>1000000) return res.status(400).json({error:'Enter a non-zero whole number of coins.'});
  const ms=await mongoose.startSession(); let updated;
  try{ await ms.withTransaction(async()=>{ const q={_id:req.params.id}; if(delta<0) q.coins={$gte:Math.abs(delta)}; updated=await User.findOneAndUpdate(q,{$inc:{coins:delta}},{new:true,session:ms}).select('-passwordHash'); if(!updated) throw Object.assign(new Error(delta<0?'User does not exist or has insufficient coins.':'User not found.'),{status:404}); await WalletTransaction.create([{userId:updated._id,type:'admin_adjustment',delta,balanceAfter:updated.coins,description:reason}],{session:ms}); }); }finally{ await ms.endSession(); }
  res.json({ok:true,user:updated});
}));
app.get('/api/admin/payments',requireAuth,requireAdmin,asyncRoute(async(req,res)=>{ const rows=await Payment.find().populate('userId','name email').sort({createdAt:-1}).limit(300); res.json(rows.map(p=>({reference:p.reference,user:p.userId?{name:p.userId.name,email:p.userId.email}:null,coins:p.coins,amountMinor:p.amountMinor,currency:p.currency,provider:p.provider||'paystack',status:p.status,credited:p.credited,createdAt:p.createdAt,paidAt:p.paidAt}))); }));
app.get('/downloads/TEDDY-XMD.apk',(req,res)=>{ const apkPath=path.join(__dirname,'public','downloads','TEDDY-XMD.apk'); if(!fs.existsSync(apkPath)) return res.status(404).type('text/plain').send('TEDDY-XMD Android APK is not available yet.'); res.setHeader('Content-Type','application/vnd.android.package-archive'); res.setHeader('Content-Disposition','attachment; filename="TEDDY-XMD.apk"'); return res.sendFile(apkPath); });
app.use(express.static(path.join(__dirname,'public')));
app.get('/{*splat}',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
async function registerTelegramWebhook(){
  if(!TELEGRAM_BOT_TOKEN || !config.PUBLIC_URL) return;
  const webhookUrl = `${String(config.PUBLIC_URL).replace(/\/$/,'')}/api/telegram/webhook`;
  const body = {url:webhookUrl,allowed_updates:['message','callback_query']};
  try{
    await telegramApi('setWebhook',body);
    console.log('Telegram webhook registered:',webhookUrl);
  }catch(e){ console.error('Telegram webhook registration failed:',e.message); }
}
async function start(){
  if(!config.MONGODB_URI||String(config.MONGODB_URI).includes('PASTE_YOUR_')){ console.error('Set MONGODB_URI in Heroku Settings > Config Vars.'); process.exit(1); }
  if(!config.SESSION_SECRET||String(config.SESSION_SECRET).length<32||String(config.SESSION_SECRET).startsWith('REPLACE_WITH_')){ console.error('Set SESSION_SECRET in Heroku Config Vars to a unique random value of at least 32 characters.'); process.exit(1); }
  if(!config.ADMIN?.EMAIL||String(config.ADMIN.EMAIL).startsWith('YOUR_')||!config.ADMIN?.PASSWORD||String(config.ADMIN.PASSWORD).startsWith('CHANGE_THIS')||String(config.ADMIN.PASSWORD).length<8){ console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in Heroku Config Vars (password at least 8 characters).'); process.exit(1); }
  await mongoose.connect(config.MONGODB_URI); console.log('Connected to MongoDB Atlas.'); console.log(`Binance Pay: MANUAL + LIVE | Configured: ${isBinancePayConfigured()} | UID: ${BINANCE_PAY_UID ? 'set' : 'MISSING'} | Email: ${BINANCE_PAY_EMAIL ? 'set' : 'MISSING'} | Telegram: ${TELEGRAM_BOT_TOKEN ? 'set' : 'MISSING'} | Approval: NEVER EXPIRES`);
  try{ const idx=await User.collection.indexes(); for(const name of ['username_1','referralCode_1','number_1']){ if(idx.some(i=>i.name===name)){ await User.collection.dropIndex(name); console.log(`Removed obsolete MongoDB users.${name} index.`); } } }catch(e){ if(![26,27].includes(e.code)&&!/not found|ns does not exist/i.test(e.message||'')) throw e; }
  const adminEmail=String(config.ADMIN.EMAIL||'').trim().toLowerCase(); const adminPassword=String(config.ADMIN.PASSWORD||''); if(!adminEmail||adminPassword.length<8) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 8 characters).');
  let admin=await User.findOne({email:adminEmail}); if(!admin){ admin=await User.create({name:'Teddy Tech Admin',email:adminEmail,passwordHash:await bcrypt.hash(adminPassword,12),role:'admin',coins:0}); console.log(`Created administrator account: ${adminEmail}`); } else if(admin.role!=='admin'){ admin.role='admin'; await admin.save(); }
  const server = app.listen(PORT,()=>{ console.log(`TEDDY TECH BOT DEPLOYER listening on ${PORT}`); registerTelegramWebhook(); });
  // Heroku sends SIGTERM during dyno replacement/deployments; drain cleanly.
  const shutdown = signal => {
    console.log(`${signal} received; closing HTTP server...`);
    server.close(async () => {
      try { await mongoose.disconnect(); } catch (e) { console.error('MongoDB disconnect:', e.message); }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once('SIGTERM',()=>shutdown('SIGTERM'));
  process.once('SIGINT',()=>shutdown('SIGINT'));
}
app.use((error,req,res,next)=>{ if(res.headersSent) return next(error); sendError(res,error); });
start().catch(e=>{ console.error('Startup failed:',e.message); process.exit(1); });
