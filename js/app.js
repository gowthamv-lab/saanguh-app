// ===============================
// Saanguh — Main App Orchestrator
// ===============================

const App = {
    currentPage: 'home',
    searchTimeout: null,

    async init() {
        // Initialize modules
        Auth.init();
        Playlists.init();
        Favorites.init();
        Player.init();

        // Set up event listeners
        this.setupNavigation();
        this.setupAuthModal();
        this.setupPlaylistModal();
        this.setupSearch();
        this.setupMobileMenu();

        // Set greeting based on time
        this.setGreeting();

        // Load home page content
        await this.loadHomePage();

        // Handle initial hash
        const hash = window.location.hash.replace('#', '') || 'home';
        this.navigateTo(hash);
    },

    // ===============================
    // Navigation
    // ===============================
    setupNavigation() {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                this.navigateTo(page);
            });
        });

        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.replace('#', '') || 'home';
            this.navigateTo(hash);
        });
    },

    navigateTo(page) {
        // Update nav links
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        const activeLink = document.querySelector(`[data-page="${page}"]`);
        if (activeLink) activeLink.classList.add('active');

        // Show page
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const pageEl = document.getElementById(`page-${page}`);
        if (pageEl) {
            pageEl.classList.add('active');
            window.location.hash = page;
            this.currentPage = page;

            // Load page-specific content
            if (page === 'favorites') this.renderFavorites();
            if (page === 'search') document.getElementById('search-input').focus();
        }

        // Close mobile menu
        this.closeMobileMenu();
    },

    // ===============================
    // Home Page
    // ===============================
    async loadHomePage() {
        // Load genres
        this.renderGenres();

        // Load recent songs
        const recent = Songs.getRecent();
        if (recent.length > 0) {
            this.renderSongGrid('recent-songs', recent);
        } else {
            // Load trending if no recent
            document.querySelector('#page-home .section:first-of-type .section-title').textContent = 'Trending Now 🔥';
            const trending = await Songs.search('Tamil hits');
            if (trending.length > 0) {
                this.renderSongGrid('recent-songs', trending.slice(0, 10));
            }
        }

        // Load all songs
        const allSongs = await Songs.getTrending();
        if (allSongs.length > 0) {
            this.renderSongList('all-songs', allSongs);
            // Store for featured play
            this._allSongs = allSongs;
        }

        // Featured play button
        document.getElementById('btn-play-featured').addEventListener('click', () => {
            if (this._allSongs && this._allSongs.length > 0) {
                Player.play(this._allSongs[0], this._allSongs, 0);
            }
        });
    },

    renderGenres() {
        const genres = [
            { name: 'Tamil Hits', color: 'linear-gradient(135deg, #e74c3c, #c0392b)', query: 'Tamil hits 2025' },
            { name: 'Anirudh', color: 'linear-gradient(135deg, #8B5CF6, #6D28D9)', query: 'Anirudh Ravichander' },
            { name: 'A.R. Rahman', color: 'linear-gradient(135deg, #3498db, #2980b9)', query: 'AR Rahman Tamil' },
            { name: 'Yuvan', color: 'linear-gradient(135deg, #e67e22, #d35400)', query: 'Yuvan Shankar Raja' },
            { name: 'Melody', color: 'linear-gradient(135deg, #EC4899, #DB2777)', query: 'Tamil melody songs' },
            { name: 'Kuthu', color: 'linear-gradient(135deg, #f39c12, #e74c3c)', query: 'Tamil kuthu songs' },
            { name: '90s Hits', color: 'linear-gradient(135deg, #1abc9c, #16a085)', query: 'Tamil 90s hits' },
            { name: 'Love Songs', color: 'linear-gradient(135deg, #e74c3c, #EC4899)', query: 'Tamil love songs' },
            { name: 'Hip Hop', color: 'linear-gradient(135deg, #2c3e50, #8B5CF6)', query: 'Tamil hip hop rap' },
            { name: 'Devotional', color: 'linear-gradient(135deg, #f1c40f, #e67e22)', query: 'Tamil devotional songs' },
        ];

        const grid = document.getElementById('genre-grid');
        grid.innerHTML = genres.map(g => `
            <div class="genre-card" style="background: ${g.color}" onclick="App.searchGenre('${g.query}', '${g.name}')">
                ${g.name}
            </div>
        `).join('');
    },

    async searchGenre(query, name) {
        this.navigateTo('search');
        document.getElementById('search-input').value = query;
        const results = await Songs.search(query);
        this.renderSongList('search-results', results, name);
    },

    // ===============================
    // Search
    // ===============================
    setupSearch() {
        const input = document.getElementById('search-input');
        input.addEventListener('input', () => {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(async () => {
                const query = input.value.trim();
                if (query.length < 2) {
                    document.getElementById('search-results').innerHTML = `
                        <div class="empty-state">
                            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <p>Search for your favorite songs</p>
                        </div>`;
                    return;
                }

                document.getElementById('search-results').innerHTML = `
                    <div class="empty-state">
                        <div class="loading-spinner"></div>
                        <p>Searching...</p>
                    </div>`;

                const results = await Songs.search(query);
                if (results.length > 0) {
                    this.renderSongList('search-results', results);
                } else {
                    document.getElementById('search-results').innerHTML = `
                        <div class="empty-state">
                            <p>No songs found for "${query}"</p>
                        </div>`;
                }
            }, 200);
        });
    },

    // ===============================
    // Favorites
    // ===============================
    renderFavorites() {
        const favorites = Favorites.getAll();
        document.getElementById('favorites-count').textContent = `${favorites.length} song${favorites.length !== 1 ? 's' : ''}`;

        if (favorites.length === 0) {
            document.getElementById('favorites-list').innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                    <p>Songs you like will appear here</p>
                </div>`;
            return;
        }

        this.renderSongList('favorites-list', favorites);
    },

    // ===============================
    // Playlist Detail
    // ===============================
    showPlaylist(playlistId) {
        const playlist = Playlists.getPlaylist(playlistId);
        if (!playlist) return;

        document.getElementById('playlist-title').textContent = playlist.name;
        document.getElementById('playlist-count').textContent = `${playlist.songs.length} song${playlist.songs.length !== 1 ? 's' : ''}`;
        document.getElementById('playlist-cover').textContent = playlist.emoji || '🎵';

        if (playlist.songs.length === 0) {
            document.getElementById('playlist-songs').innerHTML = `
                <div class="empty-state">
                    <p>This playlist is empty. Search for songs and add them!</p>
                </div>`;
        } else {
            this.renderSongList('playlist-songs', playlist.songs);
        }

        // Show the page
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-playlist').classList.add('active');
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

        this.closeMobileMenu();
    },

    // ===============================
    // Rendering Helpers
    // ===============================
    renderSongGrid(containerId, songs) {
        const container = document.getElementById(containerId);
        container.innerHTML = songs.map((song, i) => `
            <div class="song-card" data-song-id="${song.id}" onclick="App.playSong(${i}, '${containerId}')">
                <div class="song-card-cover">
                    ${song.cover_url
                        ? `<img src="${song.cover_url}" alt="${song.title}" loading="lazy">`
                        : `<div class="song-card-cover-placeholder"><svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>`
                    }
                    <button class="song-card-play" onclick="event.stopPropagation(); App.playSong(${i}, '${containerId}')">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </button>
                </div>
                <div class="song-card-title" title="${song.title}">${song.title}</div>
                <div class="song-card-artist">${song.artist}</div>
            </div>
        `).join('');

        // Store songs data for playback
        container._songs = songs;
    },

    renderSongList(containerId, songs, title) {
        const container = document.getElementById(containerId);
        container.innerHTML = songs.map((song, i) => {
            const isLiked = Favorites.isFavorite(song.id);
            const duration = Player.formatTime(song.duration);
            return `
            <div class="song-row" data-song-id="${song.id}" onclick="App.playSong(${i}, '${containerId}')">
                <span class="song-row-num">${i + 1}</span>
                <span class="song-row-play-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </span>
                <div class="song-row-info">
                    <div class="song-row-cover">
                        ${song.cover_url
                            ? `<img src="${song.cover_url}" alt="" loading="lazy">`
                            : `<div class="song-row-cover-placeholder">♪</div>`
                        }
                    </div>
                    <div class="song-row-text">
                        <div class="song-row-title">${song.title}</div>
                        <div class="song-row-artist">${song.artist}</div>
                    </div>
                </div>
                <div class="song-row-album">${song.album || ''}</div>
                <span class="song-row-duration">${duration}</span>
                <div class="song-row-actions">
                    <button class="btn-icon btn-like ${isLiked ? 'liked' : ''}" data-like-id="${song.id}" onclick="event.stopPropagation(); Favorites.toggle(App._getSong('${containerId}', ${i}))" title="Like">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                    </button>
                    <button class="btn-icon" onclick="event.stopPropagation(); Playlists.showAddToPlaylistMenu(App._getSong('${containerId}', ${i}), event.clientX, event.clientY)" title="Add to playlist">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    </button>
                    <button class="btn-icon" onclick="event.stopPropagation(); App.showVideoSearch(App._getSong('${containerId}', ${i}))" title="Watch Video">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>
                    </button>
                </div>
            </div>
        `}).join('');

        // Store songs data
        container._songs = songs;

        // Highlight current playing song
        Player.highlightCurrentSong();
    },

    playSong(index, containerId) {
        const container = document.getElementById(containerId);
        const songs = container._songs;
        if (songs && songs[index]) {
            Player.play(songs[index], songs, index);
        }
    },

    _getSong(containerId, index) {
        const container = document.getElementById(containerId);
        return container._songs ? container._songs[index] : null;
    },

    // ===============================
    // Video Player
    // ===============================
    showVideoSearch(song) {
        if (!song) return;
        const query = `${song.title} ${song.artist} official music video`;
        const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        
        // Create video modal
        let modal = document.getElementById('video-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'video-modal';
            modal.className = 'modal-overlay';
            document.getElementById('app').appendChild(modal);
        }

        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal" style="max-width: 800px; width: 95%;">
                <button class="modal-close" onclick="App.closeVideoModal()">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <div class="modal-header">
                    <h2>🎬 ${song.title}</h2>
                    <p>${song.artist}</p>
                </div>
                <div class="video-container" style="position:relative;width:100%;padding-bottom:56.25%;border-radius:12px;overflow:hidden;background:#000;margin-top:16px;">
                    <iframe 
                        style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;"
                        src="https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(song.title + ' ' + song.artist + ' official video')}&autoplay=1"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowfullscreen>
                    </iframe>
                </div>
                <div style="margin-top:12px;text-align:center;">
                    <a href="${ytSearchUrl}" target="_blank" rel="noopener" style="color:var(--accent-primary);font-size:0.9rem;text-decoration:none;">
                        Open in YouTube ↗
                    </a>
                </div>
            </div>
        `;

        modal.addEventListener('click', (e) => {
            if (e.target === modal) App.closeVideoModal();
        });
    },

    closeVideoModal() {
        const modal = document.getElementById('video-modal');
        if (modal) {
            modal.style.display = 'none';
            modal.innerHTML = '';
        }
    },

    // ===============================
    // Auth Modal
    // ===============================
    setupAuthModal() {
        let isLogin = true;

        const showModal = () => {
            document.getElementById('auth-modal').style.display = 'flex';
        };

        // Auth button click
        document.getElementById('btn-auth').addEventListener('click', showModal);

        // Close modal
        document.getElementById('modal-close').addEventListener('click', () => {
            document.getElementById('auth-modal').style.display = 'none';
        });

        // Click outside
        document.getElementById('auth-modal').addEventListener('click', (e) => {
            if (e.target.id === 'auth-modal') {
                document.getElementById('auth-modal').style.display = 'none';
            }
        });

        // Toggle login/signup
        document.getElementById('auth-toggle-link').addEventListener('click', (e) => {
            e.preventDefault();
            isLogin = !isLogin;

            if (isLogin) {
                document.getElementById('auth-modal-title').textContent = 'Login to Saanguh';
                document.getElementById('auth-submit').textContent = 'Login';
                document.getElementById('auth-toggle-text').textContent = "Don't have an account?";
                document.getElementById('auth-toggle-link').textContent = 'Sign Up';
                document.getElementById('auth-username-field').style.display = 'none';
            } else {
                document.getElementById('auth-modal-title').textContent = 'Create Account';
                document.getElementById('auth-submit').textContent = 'Sign Up';
                document.getElementById('auth-toggle-text').textContent = 'Already have an account?';
                document.getElementById('auth-toggle-link').textContent = 'Login';
                document.getElementById('auth-username-field').style.display = 'block';
            }

            document.getElementById('auth-error').style.display = 'none';
        });

        // Form submit
        document.getElementById('auth-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            const username = document.getElementById('auth-username').value;

            try {
                if (isLogin) {
                    Auth.signIn(email, password);
                    this.showToast('Welcome back! 🎵');
                } else {
                    Auth.signUp(email, password, username);
                    this.showToast('Account created! Welcome to Saanguh 🎉');
                }
                document.getElementById('auth-modal').style.display = 'none';
                document.getElementById('auth-form').reset();
            } catch (err) {
                const errorEl = document.getElementById('auth-error');
                errorEl.textContent = err.message;
                errorEl.style.display = 'block';
            }
        });
    },

    showAuthModal() {
        document.getElementById('auth-modal').style.display = 'flex';
    },

    // ===============================
    // Playlist Modal
    // ===============================
    setupPlaylistModal() {
        document.getElementById('btn-create-playlist').addEventListener('click', () => {
            document.getElementById('playlist-modal').style.display = 'flex';
        });

        document.getElementById('playlist-modal-close').addEventListener('click', () => {
            document.getElementById('playlist-modal').style.display = 'none';
        });

        document.getElementById('playlist-modal').addEventListener('click', (e) => {
            if (e.target.id === 'playlist-modal') {
                document.getElementById('playlist-modal').style.display = 'none';
            }
        });

        document.getElementById('playlist-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('playlist-name-input').value.trim();
            if (name) {
                Playlists.create(name);
                this.showToast(`Playlist "${name}" created! 🎵`);
                document.getElementById('playlist-modal').style.display = 'none';
                document.getElementById('playlist-form').reset();
            }
        });
    },

    // ===============================
    // Mobile Menu
    // ===============================
    setupMobileMenu() {
        const toggle = document.getElementById('mobile-menu-toggle');
        const sidebar = document.getElementById('sidebar');

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.id = 'sidebar-overlay';
        document.getElementById('app').appendChild(overlay);

        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        });

        overlay.addEventListener('click', () => {
            this.closeMobileMenu();
        });
    },

    closeMobileMenu() {
        document.getElementById('sidebar').classList.remove('open');
        const overlay = document.getElementById('sidebar-overlay');
        if (overlay) overlay.classList.remove('active');
    },

    // ===============================
    // Greeting
    // ===============================
    setGreeting() {
        const hour = new Date().getHours();
        let greeting;
        if (hour < 12) greeting = 'Good Morning ☀️';
        else if (hour < 17) greeting = 'Good Afternoon 🌤️';
        else if (hour < 21) greeting = 'Good Evening 🌅';
        else greeting = 'Good Night 🌙';

        const titleEl = document.querySelector('#page-home .page-title');
        if (titleEl) titleEl.textContent = greeting;
    },

    // ===============================
    // Toast Notifications
    // ===============================
    showToast(message) {
        const toast = document.getElementById('toast');
        document.getElementById('toast-message').textContent = message;
        toast.style.display = 'block';
        toast.style.animation = 'none';
        toast.offsetHeight;
        toast.style.animation = 'toastIn 0.3s ease forwards';

        clearTimeout(this._toastTimeout);
        this._toastTimeout = setTimeout(() => {
            toast.style.display = 'none';
        }, 2500);
    }
};

// ===============================
// Initialize on DOM ready
// ===============================
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
