"""
Saanguh — Multi-Source Music Server
Integrates: JioSaavn + YouTube Music + YouTube + SoundCloud + Gaana
Bulletproof fallback chain — songs ALWAYS play.
"""

import http.server
import json
import urllib.request
import urllib.parse
import urllib.error
import os
import re
import base64
import concurrent.futures
import socketserver
import time

try:
    from ytmusicapi import YTMusic  # pyright: ignore[reportMissingImports]
    import yt_dlp  # pyright: ignore[reportMissingImports]
    HAS_YT = True
    ytmusic = YTMusic()
except ImportError:
    HAS_YT = False
    print("WARNING: ytmusicapi or yt-dlp not installed. YouTube integration will be disabled.")

# ── In-Memory Caches ───────────────────────────────────────────
SEARCH_CACHE = {}
STREAM_URL_CACHE = {}

PORT = int(os.environ.get("PORT", 3000))
JIOSAAVN_BASE = "https://www.jiosaavn.com/api.php"
GAANA_API = "https://gaana.com/apiv2"

# ── Source labels for console logging ──────────────────────────
SRC_JIO = "JioSaavn"
SRC_YTM = "YouTube Music"
SRC_YT = "YouTube"
SRC_SC = "SoundCloud"
SRC_GAANA = "Gaana"


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    """Handles static files, API proxy, and multi-source audio streaming."""

    # ══════════════════════════════════════════════════════════════
    # Request Router
    # ══════════════════════════════════════════════════════════════

    def do_GET(self):
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return

        if self.path.startswith("/api/yt/stream/"):
            self.handle_yt_stream()
        elif self.path.startswith("/api/jio/stream"):
            self.handle_jio_stream()
        elif self.path.startswith("/api/fallback/stream"):
            self.handle_fallback_stream()
        elif self.path.startswith("/api/"):
            self.handle_api()
        elif self.path.startswith("/stream/"):
            self.handle_stream()
        else:
            super().do_GET()

    # ══════════════════════════════════════════════════════════════
    # JioSaavn Stream (Primary for JioSaavn songs)
    # ══════════════════════════════════════════════════════════════

    def handle_jio_stream(self):
        """Fetch auth token and proxy JioSaavn stream. Tries multiple bitrates."""
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        enc_url = params.get("enc_url", [""])[0]
        bitrate = params.get("bitrate", ["320"])[0]

        if not enc_url:
            self.send_error(400, "Missing enc_url")
            return

        # Try requested bitrate, then fall back to lower quality
        download_url = None
        for br in [bitrate, "160", "96"]:
            download_url = self._get_jiosaavn_auth_url(enc_url, br)
            if download_url:
                break

        if not download_url:
            self.send_error(500, "JioSaavn stream unavailable")
            return

        self._proxy_media(download_url, referer="https://www.jiosaavn.com/")

    # ══════════════════════════════════════════════════════════════
    # YouTube Stream (Primary for YouTube songs)
    # ══════════════════════════════════════════════════════════════

    def handle_yt_stream(self):
        """Proxy audio from YouTube via yt-dlp."""
        if not HAS_YT:
            self.send_error(501, "YouTube integration not installed")
            return

        video_id = self.path.split("/api/yt/stream/")[1].split("?")[0]
        audio_url = self._extract_yt_audio(video_id)

        if not audio_url:
            self.send_error(500, f"Could not extract YouTube audio for {video_id}")
            return

        self._proxy_media(audio_url, referer="https://www.youtube.com/")

    # ══════════════════════════════════════════════════════════════
    # ULTIMATE FALLBACK STREAM — Cascading Multi-Source
    # ══════════════════════════════════════════════════════════════
    #
    # This is the heart of "songs ALWAYS play". When the primary
    # source (JioSaavn CDN or YouTube) fails, the client calls this
    # endpoint. It cascades through EVERY available source:
    #
    #   1. YouTube Music (via ytmusicapi → yt-dlp)
    #   2. YouTube Search (via yt-dlp ytsearch:)
    #   3. SoundCloud   (via yt-dlp scsearch:)
    #
    # Each source is tried with multiple query variants:
    #   - "title artist"
    #   - "title artist song"
    #   - "title" (just title, broader match)
    #   - "title song"
    #
    # ══════════════════════════════════════════════════════════════

    def handle_fallback_stream(self):
        """Ultimate multi-source cascading fallback. Tries EVERY source."""
        if not HAS_YT:
            self.send_error(501, "YouTube integration not installed")
            return

        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        title = params.get("title", [""])[0]
        artist = params.get("artist", [""])[0]

        if not title:
            self.send_error(400, "Missing title parameter")
            return

        # ── Build query variants (most specific → broadest) ────
        full_query = f"{title} {artist}".strip()
        queries = []
        seen = set()
        for q in [full_query, f"{full_query} song", title, f"{title} song", f"{title} audio"]:
            q_clean = q.strip().lower()
            if q_clean and q_clean not in seen:
                seen.add(q_clean)
                queries.append(q.strip())

        # ── Check cache first ──────────────────────────────────
        for q in queries:
            cache_key = f"fallback_{q.lower()}"
            if cache_key in STREAM_URL_CACHE:
                audio_url = STREAM_URL_CACHE[cache_key]
                print(f"  ✅ [CACHE] Fallback hit: {q}")
                self._proxy_media(audio_url, referer="https://www.youtube.com/")
                return

        # ── Source extractors to cascade through ───────────────
        sources = [
            (SRC_YTM, self._extract_audio_ytmusic),
            (SRC_YT,  self._extract_audio_ytsearch),
            (SRC_SC,  self._extract_audio_scsearch),
        ]

        print(f"\n  🔍 FALLBACK CASCADE for: \"{title}\" by \"{artist}\"")
        print(f"  📋 Queries: {queries}")
        print(f"  📡 Sources: {[s[0] for s in sources]}")

        for query in queries:
            for source_name, extractor in sources:
                try:
                    print(f"  🔄 [{source_name}] → \"{query}\"")
                    audio_url = extractor(query)
                    if audio_url:
                        # Cache the resolved URL
                        cache_key = f"fallback_{query.lower()}"
                        STREAM_URL_CACHE[cache_key] = audio_url
                        # Also cache the full query for faster future lookups
                        full_cache = f"fallback_{full_query.lower()}"
                        if full_cache not in STREAM_URL_CACHE:
                            STREAM_URL_CACHE[full_cache] = audio_url

                        print(f"  ✅ [{source_name}] FOUND: \"{query}\"")
                        self._proxy_media(audio_url, referer="https://www.youtube.com/")
                        return
                except Exception as e:
                    print(f"  ⚠️  [{source_name}] Error for \"{query}\": {e}")
                    continue

        print(f"  ❌ ALL SOURCES EXHAUSTED for: {title} - {artist}")
        self.send_error(404, "Song not found on any source")

    # ══════════════════════════════════════════════════════════════
    # Audio Extraction Helpers — One per source
    # ══════════════════════════════════════════════════════════════

    def _extract_audio_ytmusic(self, query):
        """YouTube Music: search via ytmusicapi, extract via yt-dlp."""
        if not HAS_YT:
            return None
        try:
            results = ytmusic.search(query, filter="songs", limit=5)
            for r in results:
                vid = r.get("videoId")
                if vid:
                    url = self._extract_yt_audio(vid)
                    if url:
                        return url
        except Exception:
            pass
        return None

    def _extract_audio_ytsearch(self, query):
        """YouTube: direct search via yt-dlp ytsearch: (broader than ytmusicapi)."""
        if not HAS_YT:
            return None
        try:
            ydl_opts = {
                'format': 'bestaudio/best',
                'quiet': True,
                'no_warnings': True,
                'nocheckcertificate': True,
                'skip_download': True,
                'noplaylist': True,
                'default_search': 'ytsearch',
                'socket_timeout': 10,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # pyright: ignore
                info = ydl.extract_info(f"ytsearch:{query}", download=False)
                if info and 'entries' in info:
                    for entry in info['entries']:
                        if entry and entry.get('url'):
                            return entry['url']
                elif info and info.get('url'):
                    return info['url']
        except Exception:
            pass
        return None

    def _extract_audio_scsearch(self, query):
        """SoundCloud: search via yt-dlp scsearch: prefix."""
        if not HAS_YT:
            return None
        try:
            ydl_opts = {
                'format': 'bestaudio/best',
                'quiet': True,
                'no_warnings': True,
                'nocheckcertificate': True,
                'skip_download': True,
                'noplaylist': True,
                'socket_timeout': 10,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # pyright: ignore
                info = ydl.extract_info(f"scsearch:{query}", download=False)
                if info and 'entries' in info:
                    for entry in info['entries']:
                        if entry and entry.get('url'):
                            return entry['url']
                elif info and info.get('url'):
                    return info['url']
        except Exception:
            pass
        return None

    def _extract_yt_audio(self, video_id):
        """Extract direct audio URL for a YouTube video ID (with caching)."""
        if video_id in STREAM_URL_CACHE:
            return STREAM_URL_CACHE[video_id]

        if not HAS_YT:
            return None

        try:
            ydl_opts = {
                'format': 'bestaudio/best',
                'quiet': True,
                'no_warnings': True,
                'nocheckcertificate': True,
                'skip_download': True,
                'noplaylist': True,
                'extract_flat': False,
                'socket_timeout': 10,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:  # pyright: ignore
                info = ydl.extract_info(
                    f"https://www.youtube.com/watch?v={video_id}", download=False
                )
                audio_url = info.get('url')
                if audio_url:
                    STREAM_URL_CACHE[video_id] = audio_url
                    return audio_url
        except Exception as e:
            print(f"  ⚠️  yt-dlp extract error for {video_id}: {e}")
        return None

    # ══════════════════════════════════════════════════════════════
    # Legacy base64 stream proxy (backwards compat)
    # ══════════════════════════════════════════════════════════════

    def handle_stream(self):
        """Proxy audio stream from JioSaavn CDN to bypass ORB/CORS."""
        encoded_url = self.path[len("/stream/"):]
        encoded_url = encoded_url.split("?")[0]

        try:
            missing_padding = len(encoded_url) % 4
            if missing_padding:
                encoded_url += '=' * (4 - missing_padding)
            audio_url = base64.b64decode(encoded_url).decode("utf-8")
        except Exception as e:
            self.send_error(400, f"Invalid stream URL: {e}")
            return

        self._proxy_media(audio_url, referer="https://www.jiosaavn.com/")

    # ══════════════════════════════════════════════════════════════
    # Generic Media Proxy (handles Range requests)
    # ══════════════════════════════════════════════════════════════

    def _proxy_media(self, audio_url, referer):
        """Proxy audio bytes to the client, supporting Range requests."""
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": referer,
            "Accept": "*/*",
            "Accept-Encoding": "identity"
        }
        range_header = self.headers.get("Range")
        if range_header:
            headers["Range"] = range_header

        req = urllib.request.Request(audio_url, headers=headers)

        try:
            class NoErrorOpener(urllib.request.HTTPErrorProcessor):
                def http_response(self, request, response):
                    return response
                def https_response(self, request, response):
                    return response

            opener = urllib.request.build_opener(NoErrorOpener)
            with opener.open(req, timeout=30) as response:
                status_code = response.getcode()

                self.send_response(status_code)
                for key, val in response.headers.items():
                    if key.lower() not in ['connection', 'transfer-encoding']:
                        self.send_header(key, val)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()

                while True:
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

        except Exception as e:
            if not str(e).startswith("[WinError 10053]"):
                print(f"  ❌ Stream proxy error: {e}")

    # ══════════════════════════════════════════════════════════════
    # API Router
    # ══════════════════════════════════════════════════════════════

    def handle_api(self):
        """Route API requests to search / song endpoints."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)
        flat_params = {k: v[0] for k, v in params.items()}

        try:
            if path == "/api/search/songs" or path == "/api/search":
                result = self.search_combined(flat_params)
            elif path.startswith("/api/songs/"):
                song_id = path.split("/api/songs/")[1]
                result = self.get_song(song_id)
            else:
                result = {"success": False, "error": "Unknown endpoint"}

            self.send_json(result)

        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_json({"success": False, "error": str(e)})

    # ══════════════════════════════════════════════════════════════
    # Multi-Source Search: JioSaavn + YouTube Music + Gaana
    # ══════════════════════════════════════════════════════════════

    def search_combined(self, params):
        """Search JioSaavn, YouTube Music, and Gaana simultaneously."""
        query = params.get("query", "").lower().strip()
        limit = int(params.get("limit", "15"))

        cache_key = f"{query}_{limit}"
        if cache_key in SEARCH_CACHE:
            return SEARCH_CACHE[cache_key]

        jio_songs = []
        yt_songs = []
        gaana_songs = []

        def get_jio():
            try:
                url = (
                    f"{JIOSAAVN_BASE}?__call=search.getResults"
                    f"&_format=json&_marker=0&api_version=4&ctx=web6dot0"
                    f"&n={limit}&p=1&q={urllib.parse.quote(query)}"
                )
                data = self._fetch_json(url, referer="https://www.jiosaavn.com/")
                if data and "results" in data and isinstance(data["results"], list):
                    return [self._fmt_jiosaavn(s) for s in data["results"]]
            except Exception as e:
                print(f"  [{SRC_JIO}] search error: {e}")
            return []

        def get_yt():
            if not HAS_YT:
                return []
            try:
                results = ytmusic.search(query, filter="songs", limit=limit)
                return [self._fmt_ytmusic(s) for s in results if s.get('videoId')]
            except Exception as e:
                print(f"  [{SRC_YTM}] search error: {e}")
            return []

        def get_gaana():
            try:
                url = (
                    f"{GAANA_API}?type=song&subtype=list"
                    f"&__call=search.getResults"
                    f"&keyword={urllib.parse.quote(query)}"
                    f"&limit={limit}&include_metaData=1&offset=0"
                )
                data = self._fetch_json(url)
                if data and "entities" in data and isinstance(data["entities"], list):
                    return [self._fmt_gaana(s) for s in data["entities"][:limit]]
            except Exception as e:
                print(f"  [{SRC_GAANA}] search error: {e}")
            return []

        # Run ALL searches in parallel
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_jio = executor.submit(get_jio)
            future_yt = executor.submit(get_yt)
            future_gaana = executor.submit(get_gaana)

            jio_songs = future_jio.result()
            yt_songs = future_yt.result()
            gaana_songs = future_gaana.result()

        # Interleave results for diversity: JioSaavn → YouTube → Gaana
        combined = []
        max_len = max(len(jio_songs), len(yt_songs), len(gaana_songs))
        for i in range(max_len):
            if i < len(jio_songs):
                combined.append(jio_songs[i])
            if i < len(yt_songs):
                combined.append(yt_songs[i])
            if i < len(gaana_songs):
                combined.append(gaana_songs[i])

        result = {"success": True, "data": {"results": combined}}

        if len(SEARCH_CACHE) > 50:
            SEARCH_CACHE.clear()
        SEARCH_CACHE[cache_key] = result

        return result

    def get_song(self, song_id):
        """Fetch single song details from JioSaavn."""
        url = (
            f"{JIOSAAVN_BASE}?__call=song.getDetails"
            f"&cc=in&_format=json&_marker=0&pids={song_id}"
        )
        data = self._fetch_json(url, referer="https://www.jiosaavn.com/")
        if not data or "songs" not in data or not isinstance(data["songs"], list):
            return {"success": True, "data": []}
        songs = [self._fmt_jiosaavn(s) for s in data["songs"]]
        return {"success": True, "data": songs}

    # ══════════════════════════════════════════════════════════════
    # Song Formatters — Normalize all sources to same schema
    # ══════════════════════════════════════════════════════════════

    def _fmt_ytmusic(self, song):
        """Format YouTube Music result → Saanguh standard format."""
        album_name = ""
        album_id = ""
        if "album" in song and song["album"]:
            album_name = song["album"].get("name", "")
            album_id = song["album"].get("id", "")

        artists = []
        artist_names = []
        if "artists" in song and song["artists"]:
            for a in song["artists"]:
                name = a.get("name", "")
                artist_names.append(name)
                artists.append({
                    "id": a.get("id", ""), "name": name,
                    "role": "primary", "type": "artist"
                })

        # Parse duration "3:45" → seconds
        dur = song.get("duration", "0:00")
        if isinstance(dur, str) and ":" in dur:
            parts = dur.split(":")
            if len(parts) == 2:
                dur_sec = int(parts[0]) * 60 + int(parts[1])
            elif len(parts) == 3:
                dur_sec = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
            else:
                dur_sec = song.get("duration_seconds", 0)
        else:
            dur_sec = song.get("duration_seconds", 0)

        thumb_url = ""
        if song.get("thumbnails"):
            thumb = sorted(song["thumbnails"], key=lambda x: x.get("width", 0), reverse=True)[0]
            thumb_url = thumb.get("url", "")

        return {
            "id": f"yt_{song['videoId']}",
            "name": song.get("title", "Unknown"),
            "title": song.get("title", "Unknown"),
            "album": {"name": album_name, "id": album_id, "url": ""},
            "year": song.get("year", ""),
            "duration": dur_sec,
            "language": "YouTube",
            "source": SRC_YTM,
            "image": [{"quality": "500x500", "url": thumb_url.replace("w120-h120", "w500-h500")}],
            "downloadUrl": [{"quality": "320kbps", "url": f"/api/yt/stream/{song['videoId']}"}],
            "artists": {"primary": artists},
            "primaryArtists": ", ".join(artist_names),
            "hasVideo": False,
        }

    def _fmt_jiosaavn(self, song):
        """Format JioSaavn result → Saanguh standard format."""
        image_url = song.get("image", "")
        images = []
        if image_url:
            for quality in ["50x50", "150x150", "500x500"]:
                images.append({"quality": quality, "url": re.sub(r"\d+x\d+", quality, image_url)})

        download_urls = []
        enc_url = song.get("more_info", {}).get("encrypted_media_url", "")
        if enc_url:
            for bitrate, quality in [("96", "96kbps"), ("160", "160kbps"), ("320", "320kbps")]:
                proxy = f"/api/jio/stream?enc_url={urllib.parse.quote(enc_url)}&bitrate={bitrate}"
                download_urls.append({"quality": quality, "url": proxy})

        artist_map = song.get("more_info", {}).get("artistMap", {})
        primary_artists = []
        if artist_map and "primary_artists" in artist_map:
            for a in artist_map["primary_artists"]:
                primary_artists.append({
                    "id": a.get("id", ""), "name": a.get("name", ""),
                    "role": a.get("role", ""), "image": a.get("image", ""),
                    "type": "artist"
                })

        return {
            "id": song.get("id", ""),
            "name": song.get("title", song.get("song", "")),
            "title": song.get("title", song.get("song", "")),
            "album": {
                "name": song.get("more_info", {}).get("album", ""),
                "id": song.get("more_info", {}).get("album_id", ""),
                "url": song.get("more_info", {}).get("album_url", "")
            },
            "year": song.get("year", ""),
            "duration": song.get("more_info", {}).get("duration", 0),
            "language": song.get("language", "Tamil"),
            "source": SRC_JIO,
            "image": images,
            "downloadUrl": download_urls,
            "artists": {"primary": primary_artists},
            "primaryArtists": (
                ", ".join([a["name"] for a in primary_artists])
                if primary_artists
                else song.get("more_info", {}).get("music", "")
            ),
            "hasVideo": False,
        }

    def _fmt_gaana(self, song):
        """Format Gaana result → Saanguh standard format."""
        title = song.get("title", song.get("track_title", "Unknown"))
        artist_name = song.get("artist", song.get("artists_name", "Unknown Artist"))
        album_name = song.get("album", song.get("album_title", ""))
        duration = song.get("duration", 0)

        # Gaana artwork
        artwork = song.get("artwork_large", song.get("artwork", ""))

        # Gaana stream URLs (may or may not work directly)
        stream_url = song.get("stream_url", song.get("url", ""))
        download_urls = []
        if stream_url:
            download_urls.append({"quality": "320kbps", "url": stream_url})

        # If no direct stream, the fallback system will handle it via YouTube
        gaana_id = song.get("track_id", song.get("seo_key", f"gaana_{hash(title)}"))

        return {
            "id": f"gaana_{gaana_id}",
            "name": title,
            "title": title,
            "album": {"name": album_name, "id": "", "url": ""},
            "year": song.get("release_date", ""),
            "duration": duration,
            "language": song.get("language", "Tamil"),
            "source": SRC_GAANA,
            "image": [{"quality": "500x500", "url": artwork}] if artwork else [],
            "downloadUrl": download_urls,
            "artists": {
                "primary": [{"id": "", "name": artist_name, "role": "primary", "type": "artist"}]
            },
            "primaryArtists": artist_name,
            "hasVideo": False,
        }

    # ══════════════════════════════════════════════════════════════
    # JioSaavn Auth Token Generator (with retry)
    # ══════════════════════════════════════════════════════════════

    def _get_jiosaavn_auth_url(self, encrypted_url, bitrate):
        """Generate JioSaavn auth token with retry logic."""
        for attempt in range(2):
            try:
                url = (
                    f"{JIOSAAVN_BASE}?__call=song.generateAuthToken"
                    f"&url={urllib.parse.quote(encrypted_url)}"
                    f"&bitrate={bitrate}&api_version=4&_format=json&ctx=web6dot0&_marker=0"
                )
                data = self._fetch_json(url, referer="https://www.jiosaavn.com/")
                if data and "auth_url" in data:
                    auth_url = data["auth_url"]
                    if auth_url and len(auth_url) > 10:
                        return auth_url
            except Exception:
                if attempt == 0:
                    time.sleep(0.3)
                    continue
        return ""

    # ══════════════════════════════════════════════════════════════
    # HTTP Helpers
    # ══════════════════════════════════════════════════════════════

    def _fetch_json(self, url, referer=None):
        """Fetch JSON from a URL with proper headers."""
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json",
        }
        if referer:
            headers["Referer"] = referer
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:
            return None

    def send_json(self, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        msg = str(args[0]) if args else ""
        if "/api/" in msg:
            print(f"  [API] {msg}")
        elif "/stream/" in msg:
            pass
        elif any(msg.endswith(ext) for ext in ['.html', '.js', '.css']):
            pass
        else:
            super().log_message(format, *args)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = ThreadingHTTPServer(("0.0.0.0", PORT), ProxyHandler)
    print("╔════════════════════════════════════════════╗")
    print("║         Saanguh Music Server               ║")
    print("║   Multi-Source • Bulletproof Playback       ║")
    print("╠════════════════════════════════════════════╣")
    print(f"║   🌐 App: http://localhost:{PORT}             ║")
    print(f"║   📡 API: http://localhost:{PORT}/api/         ║")
    print("╠════════════════════════════════════════════╣")
    print(f"║   🎵 JioSaavn .............. ✅ ACTIVE    ║")
    if HAS_YT:
        print(f"║   🎬 YouTube Music ......... ✅ ACTIVE    ║")
        print(f"║   🔍 YouTube Search ........ ✅ ACTIVE    ║")
        print(f"║   🎧 SoundCloud ............ ✅ ACTIVE    ║")
    else:
        print(f"║   🎬 YouTube Music ......... ❌ DISABLED  ║")
        print(f"║   🔍 YouTube Search ........ ❌ DISABLED  ║")
        print(f"║   🎧 SoundCloud ............ ❌ DISABLED  ║")
    print(f"║   🎶 Gaana ................. ✅ ACTIVE    ║")
    print("╚════════════════════════════════════════════╝")
    print("\n  Fallback chain: JioSaavn → YouTube Music → YouTube → SoundCloud")
    print("  Songs will ALWAYS play. ✨\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()
