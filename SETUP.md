# Setting up DM's Desk

This takes about 20 minutes, and you only do it once. All of it is free, and no card is needed.

**Important:** free GitHub Pages needs a public repository, so anyone can read everything you commit, including old versions. Never add backups, campaign notes or spoilers to this folder. Your campaign belongs in Google Drive. The included `.gitignore` blocks backup files, but it can't catch spoilers typed into the code.

## 1. Put the app on GitHub

1. Sign in to [GitHub](https://github.com/).
2. Create a new repository named `dms-desk`. Set it to **Public** and leave it empty, with no README.
3. In this folder, push the code. The connection to GitHub is already set up:

```bash
git push -u origin main
```

Git will open a browser window to sign in to GitHub the first time.

4. In the repository, open **Settings**, then **Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**, then `main` and `/ (root)`, and click **Save**.
6. After a minute or two, your site appears at `https://wurtsmithchase-ux.github.io/dms-desk/`.

## 2. Allow the app to use your Google Drive

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project called `DM's Desk`.
2. Search for **Google Drive API** and click **Enable**.
3. Open **Google Auth Platform**, or **OAuth consent screen** if that's what you see.
4. Choose the **External** audience and fill in the app name and your email.
5. Under **Test users**, add your own Google address.
6. Under **Clients**, or **Credentials**, create an **OAuth client ID** of type **Web application**.
7. Under **Authorized JavaScript origins**, add `https://wurtsmithchase-ux.github.io`. Leave off `/dms-desk` and any slash at the end.
8. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`.

Google's menus change from time to time, so the labels may differ a little.

## 3. Connect the two

Open `config.js` and paste the Client ID between the quotes. It's safe in public code, because Google only accepts it from your site address. Then publish the change:

```bash
git add config.js
```

```bash
git commit -m "Add Google client ID"
```

```bash
git push
```

## 4. Move your campaign over

1. In the current Desk artifact, click the campaign name at the top left, then **Download backup**. Save it somewhere outside this folder.
2. Open your new Desk and sign in with Google.
3. Google will warn that the app isn't verified. That's expected because you made it for yourself. Choose **Advanced**, then continue.
4. Click the campaign name, choose **Restore from backup**, and pick the file.
5. Wait for **Saved to Drive** at the bottom left.

Stop editing the old Desk once you've downloaded the backup, or those changes won't come across. Keep the old Desk until you're happy with the new one.

The trash and page history from the old Desk don't transfer, because the backup doesn't include them.

## 5. Add it to your phone

Open your site address in your phone's browser, sign in and check that your campaign appears.

- **iPhone:** in Safari, tap Share, then **Add to Home Screen**.
- **Android:** in Chrome, open the menu, then **Add to Home screen** or **Install app**.

If the home-screen icon keeps asking you to sign in, use a normal browser tab or bookmark instead.

## Changing the code later

After a change, commit and push it, and the site updates within a few minutes. Before committing, check that you didn't add campaign details. If a change doesn't appear, refresh the page once or twice, because the app keeps a saved copy for offline use.

## Day to day

- Check for **Saved to Drive** at the bottom left before you switch devices.
- Your campaign is the file `dms-desk-campaign.json` in your Google Drive. Please don't rename or move it to the trash.
- If the Desk finds two versions, it asks which to keep. It saves the other to Drive as a dated copy.
- Download a backup now and then from the campaign menu, and keep it outside this folder.
- Google sign-in lasts about an hour. If it runs out, your work stays on the device. Tap the red notice to sign in and save.

## Spotify music (optional)

The Music panel in table mode starts your own playlists on any device running Spotify. It needs Spotify Premium.

1. Sign in at developer.spotify.com and create an app called "DM's Desk".
2. Add these redirect addresses: the Desk's web address, with the trailing slash (`https://<your-github-username>.github.io/dms-desk/`), and for local testing `http://127.0.0.1:8765/` (Spotify accepts `127.0.0.1`, not `localhost`).
3. Add your own Spotify account under the app's users. Spotify's development-mode rules limit this to a handful of accounts and need the app owner to have Premium.
4. Paste the app's Client ID into `config.js` as `spotifyClientId`. It is safe in a public repository because this sign-in has no secret.
5. On each device, open the Campaign menu and choose **Connect Spotify**. The login stays on that device.
6. Choose **Choose soundboard playlists** to pick buttons, labels, mood groups, order and the safe default. These save in your campaign file.
