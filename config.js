
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

  // Optional Binance Pay integration.
  // Leave empty until your Binance Pay merchant account is approved.
  BINANCE_PAY_API_KEY: process.env.BINANCE_PAY_API_KEY || '',
  BINANCE_PAY_SECRET_KEY: process.env.BINANCE_PAY_SECRET_KEY || '',
  BINANCE_PAY_MERCHANT_ID: process.env.BINANCE_PAY_MERCHANT_ID || '',

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

  BOT_REPOSITORIES: {
    'teddy-xmd-ultra': {
      name: 'TEDDY-XMD ULTRA',
      repoUrl: 'https://github.com/Teddyxmd/TEDDY-XMD',
      branch: 'main',
      pairingUrl: 'https://teddyxmdpair-60b69f1c4cee.herokuapp.com/',
      description: 'Teddy Tech WhatsApp automation bot'
    },
    'june-ultra': {
      name: 'JUNE ULTRA',
      repoUrl: 'https://github.com/Vinpink2/June-Ultra',
      branch: 'main',
      pairingUrl: 'https://pair-junex.onrender.com/',
      description: 'June Ultra WhatsApp bot'
    },
    'cypherx': {
      name: 'CYPHERX BOT',
      repoUrl: 'https://github.com/Dark-Xploit/CypherX',
      branch: 'main',
      pairingUrl: 'https://pair.cypherxbot.space/',
      description: 'CypherX WhatsApp automation bot'
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
