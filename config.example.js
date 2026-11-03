// Copy this file to config.js and fill in your credentials.
// Never commit config.js or share your Heroku API key.
module.exports = {
  PORT: process.env.PORT || 3000,
  ADMIN: {
    EMAIL: process.env.ADMIN_EMAIL || "admin@example.com",
    PASSWORD: process.env.ADMIN_PASSWORD || "CHANGE_THIS_LONG_PASSWORD"
  },
  HEROKU_API_KEY: process.env.HEROKU_API_KEY || "PASTE_YOUR_HEROKU_API_KEY_HERE",
  GITHUB: {
    OWNER: "Teddyxmd",
    REPO: "TEDDY-XMD",
    BRANCH: "main"
  },
  SESSION_SECRET: process.env.SESSION_SECRET || "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET",
  // Keep the deployment panel itself out of the delete/restart controls.
  PROTECTED_APP_NAMES: (process.env.PROTECTED_APP_NAMES || "").split(",").map(x => x.trim()).filter(Boolean)
};
