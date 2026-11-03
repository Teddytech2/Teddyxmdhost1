# TEDDY-XMD Android app

The Android app opens the deployment dashboard in a full-screen WebView. It does not show a browser address bar.

## Change the website destination without rebuilding the APK

Edit `public/app-config.json` and update `websiteUrl` to the HTTPS URL of the website you want the installed app to open. Add that domain to `allowedHosts` too, for example:

```json
{
  "appName": "TEDDY-XMD",
  "websiteUrl": "https://panel.example.com/",
  "allowedHosts": ["panel.example.com"]
}
```

Commit and deploy the updated dashboard. The installed app fetches this file each time it starts, so the destination can change without creating a new APK.

**Important:** The APK fetches this configuration from the original stable URL configured in `MainActivity.java`:
`https://teddyxmdhost1-39f912857ad8.herokuapp.com/app-config.json`

Keep that small Heroku app/domain online as the remote configuration host, even if the actual dashboard moves to another domain. Only `websiteUrl` and `allowedHosts` need to change when moving the dashboard. If you also retire the original Heroku host, the APK will need a new build with a different remote configuration URL.

The website destination must use HTTPS. External links not listed in `allowedHosts` open outside the app.

## Build

GitHub Actions workflow: `.github/workflows/build-android.yml`.
