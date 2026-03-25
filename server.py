"""
Saanguh — Local Dev Server with JioSaavn & YouTube API Integration
Serves static files + proxies /api/* requests.
Also proxies /stream/* and /api/yt/stream/* for audio playback.
"""

import http.server
import json
import urllib.request
import urllib.parse
import urllib.error
import os
import re
import base64

try:
    from ytmusicapi import YTMusic
    import yt_dlp
    HAS_YT = True
    ytmusic = YTMusic()
except ImportError:
    HAS_YT = False
    print("⚠️ ytmusicapi or yt-dlp not installed. YouTube integration will be disabled.")

PORT = 3000
JIOSAAVN_BASE = "https://www.jiosaavn.com/api.php"


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    """Handles static files, API proxy, and audio stream proxy."""

    def do_GET(self):
        if self.path.startswith("/api/yt/stream/"):
            self.handle_yt_stream()
        elif self.path.startswith("/api/"):
            self.handle_api()
        elif self.path.startswith("/stream/"):
            self.handle_stream()
        else:
            super().do_GET()

    def handle_yt_stream(self):
        """Proxy audio stream from YouTube via yt-dlp."""
        if not HAS_YT:
            self.send_error(501, "YouTube integration not installed")
            return
            
        video_id = self.path.split("/api/yt/stream/")[1].split("?")[0]
        
        try:
            ydl_opts = {
                'format': 'bestaudio/best',
                'quiet': True,
                'no_warnings': True,
                'nocheckcertificate': True
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
                audio_url = info['url']
        except Exception as e:
            self.send_error(500, f"Error extracting YouTube URL: {e}")
            return

        self._proxy_media(audio_url, referer="https://www.youtube.com/")

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

    def _proxy_media(self, audio_url, referer):
        """Generic media proxy to handle Range requests correctly."""
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
            # Bypass urlllib's default error handling for 206 Partial Content
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
            print(f"  ❌ Stream error: {e}")
            # Client might have disconnected, safe to ignore
            pass

    def handle_api(self):
        """Route API requests to JioSaavn and YouTube."""
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)
        flat_params = {k: v[0] for k, v in params.items()}

        try:
            if path == "/api/search/songs" or path == "/api/search":
                # Combined Search
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

    def search_combined(self, params):
        """Search both JioSaavn and YouTube simultaneously."""
        query = params.get("query", "")
        limit = int(params.get("limit", "15"))
        
        jio_songs = []
        yt_songs = []

        # 1. Fetch from JioSaavn
        try:
            url = f"{JIOSAAVN_BASE}?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n={limit}&p=1&q={urllib.parse.quote(query)}"
            data = self.fetch_jiosaavn(url)
            if data and "results" in data and isinstance(data["results"], list):
                jio_songs = [self.format_jiosaavn_song(s) for s in data["results"]]
        except Exception as e:
            print(f"JioSaavn search error: {e}")

        # 2. Fetch from YouTube Music
        if HAS_YT:
            try:
                results = ytmusic.search(query, filter="songs", limit=limit)
                yt_songs = [self.format_yt_song(s) for s in results if s.get('videoId')]
            except Exception as e:
                print(f"YouTube search error: {e}")

        # Combine results: alternate one by one for diversity
        combined = []
        for i in range(max(len(jio_songs), len(yt_songs))):
            if i < len(jio_songs):
                combined.append(jio_songs[i])
            if i < len(yt_songs):
                combined.append(yt_songs[i])

        return {"success": True, "data": {"results": combined}}

    def get_song(self, song_id):
        # Fallback for single song (used for trending lookup etc)
        url = f"{JIOSAAVN_BASE}?__call=song.getDetails&cc=in&_format=json&_marker=0&pids={song_id}"
        data = self.fetch_jiosaavn(url)
        if not data or "songs" not in data or not isinstance(data["songs"], list):
            return {"success": True, "data": []}
        songs = [self.format_jiosaavn_song(s) for s in data["songs"]]
        return {"success": True, "data": songs}

    def format_yt_song(self, song):
        """Format YouTube raw data into standard Saanguh format."""
        
        # Get standard album structure
        album_name = ""
        album_id = ""
        if "album" in song and song["album"]:
            album_name = song["album"].get("name", "")
            album_id = song["album"].get("id", "")
            
        # Artists list
        artists = []
        primary_artist_names = []
        if "artists" in song and song["artists"]:
            for a in song["artists"]:
                aname = a.get("name", "")
                primary_artist_names.append(aname)
                artists.append({"id": a.get("id", ""), "name": aname, "role": "primary", "type": "artist"})
        
        # Parse duration "3:45"
        duration_str = song.get("duration", "0:00")
        if duration_str:
            parts = duration_str.split(":")
            if len(parts) == 2:
                duration_sec = int(parts[0]) * 60 + int(parts[1])
            elif len(parts) == 3:
                duration_sec = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
            else:
                duration_sec = song.get("duration_seconds", 0)
        else:
            duration_sec = song.get("duration_seconds", 0)

        # Highres thumbnail
        thumb_url = ""
        if song.get("thumbnails"):
            # Get largest thumbnail
            thumb = sorted(song["thumbnails"], key=lambda x: x.get("width", 0), reverse=True)[0]
            thumb_url = thumb.get("url", "")

        return {
            "id": f"yt_{song['videoId']}",
            "name": song.get("title", "Unknown"),
            "title": song.get("title", "Unknown"),
            "album": {
                "name": album_name,
                "id": album_id,
                "url": ""
            },
            "year": song.get("year", ""),
            "duration": duration_sec,
            "language": "YouTube", # Mark as YouTube
            "image": [
                {"quality": "500x500", "url": thumb_url.replace("w120-h120", "w500-h500")}
            ],
            "downloadUrl": [
                {"quality": "320kbps", "url": f"/api/yt/stream/{song['videoId']}"}
            ],
            "artists": {
                "primary": artists
            },
            "primaryArtists": ", ".join(primary_artist_names),
            "hasVideo": False
        }

    def format_jiosaavn_song(self, song):
        """Format JioSaavn raw song data."""
        image_url = song.get("image", "")
        images = []
        if image_url:
            for quality in ["50x50", "150x150", "500x500"]:
                images.append({
                    "quality": quality,
                    "url": re.sub(r"\d+x\d+", quality, image_url)
                })

        download_urls = []
        encrypted_url = song.get("more_info", {}).get("encrypted_media_url", "")
        if encrypted_url:
            for bitrate, quality in [("96", "96kbps"), ("160", "160kbps"), ("320", "320kbps")]:
                download_url = self.get_jiosaavn_download_url(encrypted_url, bitrate)
                if download_url:
                    proxy_url = "/stream/" + base64.b64encode(download_url.encode()).decode()
                    download_urls.append({
                        "quality": quality,
                        "url": proxy_url
                    })

        artist_map = song.get("more_info", {}).get("artistMap", {})
        primary_artists = []
        if artist_map and "primary_artists" in artist_map:
            for a in artist_map["primary_artists"]:
                primary_artists.append({
                    "id": a.get("id", ""),
                    "name": a.get("name", ""),
                    "role": a.get("role", ""),
                    "image": a.get("image", ""),
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
            "image": images,
            "downloadUrl": download_urls,
            "artists": {
                "primary": primary_artists
            },
            "primaryArtists": ", ".join([a["name"] for a in primary_artists]) if primary_artists else song.get("more_info", {}).get("music", ""),
            "hasVideo": False
        }

    def get_jiosaavn_download_url(self, encrypted_url, bitrate):
        try:
            url = f"{JIOSAAVN_BASE}?__call=song.generateAuthToken&url={urllib.parse.quote(encrypted_url)}&bitrate={bitrate}&api_version=4&_format=json&ctx=web6dot0&_marker=0"
            data = self.fetch_jiosaavn(url)
            if data and "auth_url" in data:
                return data["auth_url"]
        except Exception:
            pass
        return ""

    def fetch_jiosaavn(self, url):
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
            "Referer": "https://www.jiosaavn.com/"
        })
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
        msg = args[0] if args else ""
        if "/api/" in msg:
            print(f"  🎵 API: {msg}")
        elif "/stream/" in msg:
            pass # Keep console clean
        elif any(msg.endswith(ext) for ext in ['.html', '.js', '.css']):
            pass
        else:
            super().log_message(format, *args)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(("", PORT), ProxyHandler)
    print(f"""
╔══════════════════════════════════════════╗
║        🔥 Saanguh Music Server 🔥        ║
║   JioSaavn + YouTube Music Integrated    ║
║                                          ║
║   App:    http://localhost:{PORT}          ║
║   API:    http://localhost:{PORT}/api/     ║
╚══════════════════════════════════════════╝
    """)
    if HAS_YT:
        print("✅ YouTube Music Search & Streaming ENABLED")
    else:
        print("❌ YouTube Music DISABLED (missing ytmusicapi or yt-dlp)")
        
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Server stopped.")
        server.server_close()
