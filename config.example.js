// Copy these settings into config.js and replace every placeholder.
// Keep real credentials out of public repositories.
module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: 'production',
  ADMIN: {
    EMAIL: 'YOUR_ADMIN_EMAIL@example.com',
    PASSWORD: 'CHANGE_THIS_TO_A_STRONG_PASSWORD'
  },
  HEROKU_API_KEY: 'PASTE_YOUR_HEROKU_API_KEY_HERE',
  MONGODB_URI: 'PASTE_YOUR_MONGODB_ATLAS_URI_HERE',
  PAYSTACK_SECRET_KEY: 'PASTE_YOUR_PAYSTACK_SECRET_KEY_HERE',
  PUBLIC_URL: 'https://YOUR-APP-NAME.herokuapp.com',
  SESSION_SECRET: 'REPLACE_WITH_A_UNIQUE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS',
  DEPLOY_COST_COINS: 10,
  KES_PER_10_COINS: 50,
  USD_PER_10_COINS: 0.4,
  PAYSTACK_USD_MINIMUM: 2,
  DEFAULT_HEROKU_APP_PREFIX: 'teddyxhost',
  PROTECTED_APP_NAMES: ['teddyxmdhost1-39f912857ad8']
};
