# LinkedPin

A local Chrome extension that captures LinkedIn feed posts and appends them directly into a Google Doc in strict serial order.

## What changed in this refactor

- Removed old Node server artifacts.
- Improved post detection to reduce ambiguity:
  - Uses last clicked post when available.
  - Falls back to hovered post.
  - Falls back to the visible post closest to viewport center.
- Moved Google Doc ID input into a collapsible Settings section in popup.

## Project structure

- `extension/manifest.json`: extension config and OAuth scopes.
- `extension/content.js`: LinkedIn post detection and extraction.
- `extension/background.js`: Google auth and queued Docs writes.
- `extension/popup.html`: popup UI.
- `extension/popup.css`: popup styling.
- `extension/popup.js`: popup interaction and settings storage.

## Setup: Google Developer Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create/select a project.
2. Go to `APIs & Services` -> `Library`.
3. Enable `Google Docs API`.
4. Go to `APIs & Services` -> `OAuth consent screen`.
5. Configure app details and add yourself as a test user.
6. Add scope: `https://www.googleapis.com/auth/documents`.
7. Go to `APIs & Services` -> `Credentials`.
8. Click `Create Credentials` -> `OAuth client ID`.
9. Select `Chrome Extension`.
10. Enter your extension ID from `chrome://extensions`.
11. Copy generated Client ID.

## Installation guide

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `/Users/hasime/linkedpin/extension`.
5. Open `/Users/hasime/linkedpin/extension/manifest.json`.
6. Replace `REPLACE_WITH_YOUR_CHROME_EXTENSION_OAUTH_CLIENT_ID` with your OAuth client ID.
7. Go back to `chrome://extensions`.
8. Click `Reload` on LinkedPin Saver.

## First use

1. Open your Google Doc and copy `<DOC_ID>` from URL:
   - `https://docs.google.com/document/d/<DOC_ID>/edit`
2. Open extension popup.
3. Click `Show Settings`.
4. Paste Doc ID and click `Save Doc ID`.
5. Open LinkedIn feed page.
6. Click inside a post for exact targeting (optional now, but recommended).
7. Click extension icon -> `Save Post to Google Docs`.
8. Complete Google OAuth prompt on first run.

## Known bugs and resolutions

1. OAuth error (`not granted`, `revoked`, `invalid_client`)
- Ensure OAuth client type is `Chrome Extension`.
- Ensure extension ID in credential exactly matches loaded extension ID.
- Ensure your Google account is a Test User in consent screen.
- Reload extension after manifest changes.

2. Could not find post / wrong post captured
- Scroll so the target post is clearly visible.
- Click inside exact post to force precise selection.
- If LinkedIn changed DOM structure, update selectors in `extension/content.js`.

3. `403` or Docs API access errors
- Confirm `Google Docs API` is enabled in the same project as OAuth credential.
- Confirm signed-in Google account can edit the target doc.
- Verify Doc ID is correct in extension settings.

4. Doc ID not visible in popup
- This is expected now.
- Click `Show Settings` to view/edit Doc ID.

## Security notes

- Intended for private local use.
- Do not publish with your personal OAuth client ID.


## TO DO
- Implement content pulling from timeline only