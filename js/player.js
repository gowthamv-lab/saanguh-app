// ===============================
// Playlists Module
// ===============================

const Playlists = {
    list: [],

    init() {
        this.list = LocalDB.get('playlists') || [];
        this.renderSidebar();
    },

    create(name) {
        const playlist = {
            id: 'pl_' + Date.now(),
            name,
            songs: [],
            created_at: new Date().toISOString(),
            emoji: this.getRandomEmoji()
        };
        this.list.push(playlist);
        this.save();
        this.renderSidebar();
        return playlist;
    },

    delete(playlistId) {
        this.list = this.list.filter(p => p.id !== playlistId);
        this.save();
        this.renderSidebar();
    },

    addSong(playlistId, song) {
        const playlist = this.list.find(p => p.id === playlistId);
        if (!playlist) return false;

        // Check if song already exists
        if (playlist.songs.find(s => s.id === song.id)) {
            App.showToast('Song already in playlist');
            return false;
        }

        playlist.songs.push(song);
        this.save();
        App.showToast(`Added to ${playlist.name}`);
        return true;
    },

    removeSong(playlistId, songId) {
        const playlist = this.list.find(p => p.id === playlistId);
        if (!playlist) return;
        playlist.songs = playlist.songs.filter(s => s.id !== songId);
        this.save();
    },

    getPlaylist(playlistId) {
        return this.list.find(p => p.id === playlistId);
    },

    save() {
        LocalDB.set('playlists', this.list);
    },

    renderSidebar() {
        const container = document.getElementById('playlist-list');
        if (this.list.length === 0) {
            container.innerHTML = '<p style="padding: 8px 14px; font-size: 0.8rem; color: var(--text-tertiary);">No playlists yet</p>';
            return;
        }

        container.innerHTML = this.list.map(pl => `
            <div class="playlist-item" data-playlist-id="${pl.id}" onclick="App.showPlaylist('${pl.id}')">
                <div class="playlist-item-icon">${pl.emoji || '🎵'}</div>
                <span>${pl.name}</span>
            </div>
        `).join('');
    },

    // Show context menu to add song to playlist
    showAddToPlaylistMenu(song, x, y) {
        // Remove existing context menu
        document.querySelectorAll('.context-menu').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';

        let items = '<button class="context-menu-item" onclick="Playlists.createAndAdd()" style="border-bottom: 1px solid var(--border-color); margin-bottom: 4px; padding-bottom: 12px;">➕ Create New Playlist</button>';

        this.list.forEach(pl => {
            items += `<button class="context-menu-item" onclick="Playlists.addSong('${pl.id}', Playlists._tempSong)">${pl.emoji} ${pl.name}</button>`;
        });

        menu.innerHTML = items;
        document.body.appendChild(menu);

        // Store the song temporarily
        this._tempSong = song;

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 10);

        // Adjust position if menu goes off screen
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
        }
    },

    createAndAdd() {
        document.querySelectorAll('.context-menu').forEach(m => m.remove());
        const name = prompt('Enter playlist name:');
        if (name) {
            const pl = this.create(name);
            if (this._tempSong) {
                this.addSong(pl.id, this._tempSong);
            }
        }
    },

    getRandomEmoji() {
        const emojis = ['🎵', '🎶', '🎧', '🎸', '🎹', '🎺', '🥁', '🎻', '🎤', '🌟', '💫', '🔥', '💜', '🌙', '✨', '🎭'];
        return emojis[Math.floor(Math.random() * emojis.length)];
    }
};
