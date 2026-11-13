module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'production',

  ADMIN: {
    EMAIL: process.env.ADMIN_EMAIL || 'teddyxmd@admin.com',
    PASSWORD: process.env.ADMIN_PASSWORD || 'teddyxmd'
  },

  HEROKU_API_KEY: process.env.HEROKU_API_KEY || '',
  MONGODB_URI: process.env.MONGODB_URI || '',
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || '',

  // ---------------- Binance Pay — MANUAL + LIVE ----------------
  // NO Binance API. User sends USDT to your ID / Email, uploads receipt,
  // you Approve / Reject on Telegram. Approval NEVER expires.
  BINANCE_PAY_ENABLED: true,
  BINANCE_PAY_COMING_SOON: false,
  BINANCE_PAY_MODE: 'manual',
  BINANCE_PAY_CURRENCY: process.env.BINANCE_PAY_CURRENCY || 'USDT',

  // Your Binance ID and Email to receive USDT
  // Set these in Heroku Config Vars
  BINANCE_PAY_UID: process.env.BINANCE_PAY_UID || '1176021082',
  BINANCE_PAY_EMAIL: process.env.BINANCE_PAY_EMAIL || 'kibetwycliffe093@gmail.com',
  BINANCE_PAY_ID: process.env.BINANCE_PAY_UID || '',

  BINANCE_PAY_MINIMUM_USD: Number(process.env.BINANCE_PAY_MINIMUM_USD || 0.4),
  BINANCE_PAY_MINIMUM_COINS: Number(process.env.BINANCE_PAY_MINIMUM_COINS || 10),
  // Approval never expires - do not use this to block approve/reject
  BINANCE_PAY_APPROVAL_EXPIRES: false,
  BINANCE_PAY_EXPIRES_AT: null,

  // ---------------- Telegram — Admin Approval ----------------
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_ADMIN_CHAT_ID: process.env.TELEGRAM_ADMIN_CHAT_ID || '6815918612',
  TELEGRAM_ENABLED: true,

  PUBLIC_URL: process.env.PUBLIC_URL || 'https://teddyxmd.new.tg',
  SESSION_SECRET: process.env.SESSION_SECRET || '',

  DEPLOY_COST_COINS: Number(process.env.DEPLOY_COST_COINS || 10),
  KES_PER_10_COINS: Number(process.env.KES_PER_10_COINS || 50),
  USD_PER_10_COINS: Number(process.env.USD_PER_10_COINS || 0.4),
  PAYSTACK_USD_MINIMUM: Number(process.env.PAYSTACK_USD_MINIMUM || 0.4),

  SUPPORT_WHATSAPP: process.env.SUPPORT_WHATSAPP || '254799963583',

  PAIRING_WEBSITE_URL:
    process.env.PAIRING_WEBSITE_URL ||
    'https://teddyxmdpair-60b69f1c4cee.herokuapp.com/',

  // ALL 3 BOTS KEPT — TEDDY-XMD = full configs, JUNE / CYPHERX = SESSION_ID only
  BOT_REPOSITORIES: {
    'teddy-xmd-ultra': {
      name: 'TEDDY-XMD ULTRA',
      repoUrl: 'https://github.com/Teddyxmd/TEDDY-XMD',
      branch: 'main',
      pairingUrl: 'https://teddyxmdpair-60b69f1c4cee.herokuapp.com/',
      description: 'Teddy Tech WhatsApp automation bot',
      envMode: 'full' // SESSION_ID + all 26 TEDDY-XMD vars from app.json
    },
    'june-ultra': {
      name: 'JUNE ULTRA',
      repoUrl: 'https://github.com/Vinpink2/June-Ultra',
      branch: 'main',
      pairingUrl: 'https://pair-junex.onrender.com/',
      description: 'June Ultra WhatsApp bot',
      envMode: 'session-only' // SESSION_ID only
    },
    'cypherx': {
      name: 'CYPHERX BOT',
      repoUrl: 'https://github.com/Dark-Xploit/CypherX',
      branch: 'main',
      pairingUrl: 'https://pair.cypherxbot.space/',
      description: 'CypherX WhatsApp automation bot',
      envMode: 'session-only' // SESSION_ID only
    }
  },

  DEFAULT_HEROKU_APP_PREFIX:
    process.env.DEFAULT_HEROKU_APP_PREFIX || 'teddyxhost',

  PROTECTED_APP_NAMES:
    (process.env.PROTECTED_APP_NAMES || 'teddyxmdhost1-39f912857ad8')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean)
};
