# Implementation Plan: YouTube & Spotify Integration

## Goal Description
The user wants to expand the Saanguh music app's search and playback capabilities beyond JioSaavn, specifically requesting integration with Spotify and YouTube to ensure any "particular song" can be found and played.

Since Spotify API does not allow full audio playback without a Premium account and user authentication, the standard and most reliable approach for premium web music players is to use **YouTube Music for both search and audio streaming**, as its catalog matches Spotify's and it allows fetching free audio streams without authentication.

## User Review Required
> [!IMPORTANT]
> To reliably search and stream music from YouTube and Spotify-like catalogs, we need to install two Python packages in your backend:
> 1. `ytmusicapi` (for searching the massive YouTube Music catalog)
> 2. `yt-dlp` (for extracting the direct high-quality audio stream)
>
> I will run `pip install ytmusicapi yt-dlp` in your terminal to set this up. Do you approve this approach?

## Proposed Changes

---
### Backend Framework (Python Server)

#### [MODIFY] server.py
- Add `ytmusicapi` initialization to search YouTube Music.
- Create `/api/yt/search` endpoint to handle queries and return formatted song data matching the existing Saanguh structure.
- Create `/api/yt/stream` endpoint using `yt-dlp` to fetch the direct audio `.m4a` or `.webm` URL and proxy it to bypass CORS restrictions.
- Create a combined search endpoint that merges results from JioSaavn and YouTube Music to guarantee the user finds any song they search for.

---
### Frontend Application

#### [MODIFY] js/songs.js
- Update the [search](file:///e:/saanguh-app/js/songs.js#12-26) function to call the new combined API endpoint instead of just JioSaavn.
- Update [formatSong](file:///e:/saanguh-app/js/songs.js#75-127) to handle YouTube metadata (thumbnails, video IDs).

#### [MODIFY] index.html & js/app.js
- (Optional) Add a badge or indicator on song cards to show if it's from YouTube or JioSaavn.
- Ensure the audio player correctly receives and plays the new YouTube stream URLs.

## Verification Plan

### Automated/Local Tests
- Run [server.py](file:///e:/saanguh-app/server.py) with the new endpoints.
- Perform a [GET](file:///e:/saanguh-app/server.py#22-29) request to `/api/yt/search?query=shape+of+you` to verify YouTube search returns data.

### Manual Verification
- Open `localhost:3000` in the browser.
- Search for a very specific English or Tamil song that might not be on JioSaavn.
- Verify the search results appear.
- Click "Play" on a YouTube-sourced song and verify the audio plays without errors or buffering issues.
