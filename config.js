// TEDDY TECH BOT DEPLOYER — central configuration.
// Edit the values in this file before deploying. Keep this repository PRIVATE
// because this file can contain live credentials. Environment variables, when
// supplied by Heroku, override the values below.
module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'production',

  // Administrator account created on the first successful startup.
  ADMIN: {
    EMAIL: process.env.ADMIN_EMAIL || 'teddyxmd@admin.com',
    PASSWORD: process.env.ADMIN_PASSWORD || 'teddyxmd'
  },

  // Service credentials. Replace the placeholders with your real credentials.
  HEROKU_API_KEY: process.env.HEROKU_API_KEY || '',
  MONGODB_URI: process.env.MONGODB_URI || '',
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || '',

  // Exact public URL of this deployment panel (no trailing slash required).
  PUBLIC_URL: process.env.PUBLIC_URL || 'https://teddyxmd.new.tg',

  // Use a unique random value of at least 32 characters.
  SESSION_SECRET: process.env.SESSION_SECRET || '',

  // Pricing: every bot deployment costs 10 coins; 10 coins = KSh 50.
  DEPLOY_COST_COINS: Number(process.env.DEPLOY_COST_COINS || 10),
  KES_PER_10_COINS: Number(process.env.KES_PER_10_COINS || 50),
  USD_PER_10_COINS: Number(process.env.USD_PER_10_COINS || 0.4),
  PAYSTACK_USD_MINIMUM: Number(process.env.PAYSTACK_USD_MINIMUM || 2),

  // Customer support WhatsApp number in international format, digits only.
  SUPPORT_WHATSAPP: process.env.SUPPORT_WHATSAPP || '254799963583',

  // Website where users generate WhatsApp pairing SESSION_IDs.
  PAIRING_WEBSITE_URL: process.env.PAIRING_WEBSITE_URL || 'https://teddyxmdpair-60b69f1c4cee.herokuapp.com/',

  // Built-in bot catalogue. Users select a bot and provide only its SESSION_ID.
  BOT_REPOSITORIES: {
    'teddy-xmd-ultra': { name: 'TEDDY-XMD ULTRA', repoUrl: 'https://github.com/Teddyxmd/TEDDY-XMD', branch: 'main', pairingUrl: 'https://teddyxmdpair-60b69f1c4cee.herokuapp.com/', description: 'Teddy Tech WhatsApp automation bot' },
    'june-ultra': { name: 'JUNE ULTRA', repoUrl: 'https://github.com/Vinpink2/June-Ultra', branch: 'main', pairingUrl: 'https://pair-junex.onrender.com/', description: 'June Ultra WhatsApp bot' },
    'cypherx': { name: 'CYPHERX BOT', repoUrl: 'https://github.com/Dark-Xploit/CypherX', branch: 'main', pairingUrl: 'https://pair.cypherxbot.space/', description: 'CypherX WhatsApp automation bot' }
  },

  // Default prefix used when suggesting unique Heroku application names.
  DEFAULT_HEROKU_APP_PREFIX: process.env.DEFAULT_HEROKU_APP_PREFIX || 'teddyxhost',

  // Prevent the panel itself (and any other listed apps) from being managed
  // or deleted by customers. Separate multiple names with commas.
  PROTECTED_APP_NAMES: (process.env.PROTECTED_APP_NAMES || 'teddyxmdhost1-39f912857ad8').split(',').map(x => x.trim()).filter(Boolean)
};
