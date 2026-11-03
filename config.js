// TEDDY-XMD DEPLOYER configuration.
// You can enter credentials here, or provide the matching Heroku Config Vars.
// Keep this file private if you put real credentials in it.
module.exports = {
  PORT: process.env.PORT || 3000,
  ADMIN: {
    EMAIL: process.env.ADMIN_EMAIL || "admin@teddyxmd.space",
    PASSWORD: process.env.ADMIN_PASSWORD || "teddyxmd"
  },
  HEROKU_API_KEY: process.env.HEROKU_API_KEY || "PASTE_YOUR_HEROKU_API_KEY_HERE",
  GITHUB: {
    OWNER: "Teddyxmd",
    REPO: "TEDDY-XMD",
    BRANCH: process.env.GITHUB_BRANCH || "main"
  },
  SESSION_SECRET: process.env.SESSION_SECRET || "just56035testc#_y",
  PROTECTED_APP_NAMES: (process.env.PROTECTED_APP_NAMES || "").split(",").map(x => x.trim()).filter(Boolean)
};
