// ===============================
// Songs Module — JioSaavn API Integration
// ===============================

// Use local proxy server (run server.py to start)
const JIOSAAVN_API = '/api';

const Songs = {
    allSongs: [],
    isLoading: false,

    // Search songs from JioSaavn
    async search(query) {
        try {
            const res = await fetch(`${JIOSAAVN_API}/search/songs?query=${encodeURIComponent(query)}&limit=30`);
            const data = await res.json();
            if (data.success && data.data && data.data.results) {
                return data.data.results.map(song => this.formatSong(song));
            }
            return [];
        } catch (err) {
            console.error('Search error:', err);
            return [];
        }
    },

    // Get trending/top songs
    async getTrending() {
        try {
            // Search for popular Tamil songs
            const queries = ['Tamil hits 2025', 'Anirudh Tamil', 'Tamil melody'];
            const randomQuery = queries[Math.floor(Math.random() * queries.length)];
            const res = await fetch(`${JIOSAAVN_API}/search/songs?query=${encodeURIComponent(randomQuery)}&limit=20`);
            const data = await res.json();
            if (data.success && data.data && data.data.results) {
                return data.data.results.map(song => this.formatSong(song));
            }
            return [];
        } catch (err) {
            console.error('Trending error:', err);
            return [];
        }
    },

    // Get songs by specific query/genre
    async getByGenre(genre) {
        try {
            const res = await fetch(`${JIOSAAVN_API}/search/songs?query=${encodeURIComponent(genre)}&limit=20`);
            const data = await res.json();
            if (data.success && data.data && data.data.results) {
                return data.data.results.map(song => this.formatSong(song));
            }
            return [];
        } catch (err) {
            console.error('Genre fetch error:', err);
            return [];
        }
    },

    // Get song details by ID
    async getSongById(id) {
        try {
            const res = await fetch(`${JIOSAAVN_API}/songs/${id}`);
            const data = await res.json();
            if (data.success && data.data && data.data.length > 0) {
                return this.formatSong(data.data[0]);
            }
            return null;
        } catch (err) {
            console.error('Song detail error:', err);
            return null;
        }
    },

    // Format JioSaavn song data to our standard format
    formatSong(song) {
        // Get best quality download URL
        let audioUrl = '';
        if (song.downloadUrl) {
            // Get highest quality available
            const urls = song.downloadUrl;
            if (Array.isArray(urls)) {
                const best = urls.find(u => u.quality === '320kbps') ||
                             urls.find(u => u.quality === '160kbps') ||
                             urls.find(u => u.quality === '96kbps') ||
                             urls[urls.length - 1];
                audioUrl = best ? best.url : '';
            } else if (typeof urls === 'string') {
                audioUrl = urls;
            }
        }

        // Get best quality image
        let coverUrl = '';
        if (song.image) {
            if (Array.isArray(song.image)) {
                const bestImg = song.image.find(i => i.quality === '500x500') ||
                                song.image.find(i => i.quality === '150x150') ||
                                song.image[song.image.length - 1];
                coverUrl = bestImg ? bestImg.url : '';
            } else if (typeof song.image === 'string') {
                coverUrl = song.image;
            }
        }

        // Get artist names
        let artistName = 'Unknown Artist';
        if (song.artists && song.artists.primary && song.artists.primary.length > 0) {
            artistName = song.artists.primary.map(a => a.name).join(', ');
        } else if (song.primaryArtists) {
            artistName = song.primaryArtists;
        }

        return {
            id: song.id,
            title: this.decodeHTML(song.name || song.title || 'Unknown'),
            artist: this.decodeHTML(artistName),
            album: this.decodeHTML(song.album?.name || song.album || ''),
            genre: song.language || 'Tamil',
            cover_url: coverUrl,
            audio_url: audioUrl,
            duration: song.duration || 0,
            year: song.year || '',
            has_video: song.hasVideo || false
        };
    },

    // Decode HTML entities that come from the API
    decodeHTML(text) {
        if (!text) return '';
        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        return textarea.value;
    },

    // Add to recently played
    addToRecent(song) {
        let recent = LocalDB.get('recent') || [];
        // Remove if already exists
        recent = recent.filter(s => s.id !== song.id);
        // Add to beginning
        recent.unshift(song);
        // Keep only last 20
        recent = recent.slice(0, 20);
        LocalDB.set('recent', recent);
    },

    // Get recently played
    getRecent() {
        return LocalDB.get('recent') || [];
    }
};
