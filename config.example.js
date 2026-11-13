// Heroku Config Vars are the source of all credentials.
// Set these in Heroku Settings > Config Vars; never commit real secrets.
module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'production',
  ADMIN: { EMAIL: process.env.ADMIN_EMAIL || '', PASSWORD: process.env.ADMIN_PASSWORD || '' },
  HEROKU_API_KEY: process.env.HEROKU_API_KEY || '',
  MONGODB_URI: process.env.MONGODB_URI || '',
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || '',
  PUBLIC_URL: process.env.PUBLIC_URL || '',
  SESSION_SECRET: process.env.SESSION_SECRET || '',
  DEPLOY_COST_COINS: Number(process.env.DEPLOY_COST_COINS || 10),
  KES_PER_10_COINS: Number(process.env.KES_PER_10_COINS || 50),
  USD_PER_10_COINS: Number(process.env.USD_PER_10_COINS || 0.4),
  PAYSTACK_USD_MINIMUM: Number(process.env.PAYSTACK_USD_MINIMUM || 2),
  DEFAULT_HEROKU_APP_PREFIX: process.env.DEFAULT_HEROKU_APP_PREFIX || 'teddyxhost',
  SUPPORT_WHATSAPP: process.env.SUPPORT_WHATSAPP || '254799963583',
  SUPPORT_WELCOME_MESSAGE: process.env.SUPPORT_WELCOME_MESSAGE || 'Hello, this is TEDDY-XMD assistant. How can I help you?',
  PAIRING_WEBSITE_URL: process.env.PAIRING_WEBSITE_URL || 'https://teddyxmdpair-60b69f1c4cee.herokuapp.com/',
  PROTECTED_APP_NAMES: (process.env.PROTECTED_APP_NAMES || '').split(',').map(x => x.trim()).filter(Boolean)
};
