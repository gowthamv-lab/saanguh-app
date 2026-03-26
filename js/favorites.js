// ===============================
// Audio Player Module
// ===============================

const Player = {
    audio: null,
    currentSong: null,
    queue: [],
    currentIndex: -1,
    isPlaying: false,
    isShuffle: false,
    repeatMode: 0, // 0: off, 1: all, 2: one
    volume: 0.8,

    init() {
        this.audio = document.getElementById('audio-player');
        this.audio.volume = this.volume;

        // Audio event listeners
        this.audio.addEventListener('timeupdate', () => this.updateProgress());
        this.audio.addEventListener('ended', () => this.onSongEnd());
        this.audio.addEventListener('loadedmetadata', () => this.onMetadataLoaded());
        this.audio.addEventListener('play', () => this.onPlay());
        this.audio.addEventListener('pause', () => this.onPause());
        this.audio.addEventListener('error', (e) => this.onError(e));

        // Controls
        document.getElementById('btn-play').addEventListener('click', () => this.togglePlay());
        document.getElementById('btn-next').addEventListener('click', () => this.next());
        document.getElementById('btn-prev').addEventListener('click', () => this.previous());
        document.getElementById('btn-shuffle').addEventListener('click', () => this.toggleShuffle());
        document.getElementById('btn-repeat').addEventListener('click', () => this.toggleRepeat());

        // Progress bar
        const progressBar = document.getElementById('progress-bar');
        progressBar.addEventListener('click', (e) => this.seekTo(e));

        // Volume
        const volumeBar = document.getElementById('volume-bar');
        volumeBar.addEventListener('click', (e) => this.setVolume(e));
        document.getElementById('btn-volume').addEventListener('click', () => this.toggleMute());

        // Like button
        document.getElementById('player-like').addEventListener('click', () => {
            if (this.currentSong) {
                Favorites.toggle(this.currentSong);
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            switch(e.code) {
                case 'Space':
                    e.preventDefault();
                    this.togglePlay();
                    break;
                case 'ArrowRight':
                    if (e.shiftKey) this.next();
                    else this.audio.currentTime = Math.min(this.audio.currentTime + 5, this.audio.duration);
                    break;
                case 'ArrowLeft':
                    if (e.shiftKey) this.previous();
                    else this.audio.currentTime = Math.max(this.audio.currentTime - 5, 0);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.audio.volume = Math.min(this.audio.volume + 0.1, 1);
                    this.updateVolumeUI();
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.audio.volume = Math.max(this.audio.volume - 0.1, 0);
                    this.updateVolumeUI();
                    break;
            }
        });
    },

    // Play a song
    play(song, queue = null, index = -1) {
        if (!song || !song.audio_url) {
            App.showToast('This song is not available for streaming');
            return;
        }

        this.currentSong = song;
        if (queue) {
            this.queue = queue;
            this.currentIndex = index;
        }

        this.audio.src = song.audio_url;
        this.audio.play().catch(err => {
            console.error('Play error:', err);
            App.showToast('Unable to play this song');
        });

        // Update UI
        this.updatePlayerUI(song);

        // Add to recently played
        Songs.addToRecent(song);

        // Update song rows to show current playing
        this.highlightCurrentSong();

        // Update media session (for OS-level controls)
        this.updateMediaSession(song);
    },

    togglePlay() {
        if (!this.currentSong) return;
        if (this.isPlaying) {
            this.audio.pause();
        } else {
            this.audio.play().catch(() => {});
        }
    },

    next() {
        if (this.queue.length === 0) return;

        let nextIndex;
        if (this.isShuffle) {
            nextIndex = Math.floor(Math.random() * this.queue.length);
        } else {
            nextIndex = this.currentIndex + 1;
            if (nextIndex >= this.queue.length) {
                if (this.repeatMode === 1) {
                    nextIndex = 0;
                } else {
                    return;
                }
            }
        }

        this.currentIndex = nextIndex;
        this.play(this.queue[nextIndex], this.queue, nextIndex);
    },

    previous() {
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            return;
        }

        if (this.queue.length === 0) return;
        let prevIndex = this.currentIndex - 1;
        if (prevIndex < 0) {
            if (this.repeatMode === 1) {
                prevIndex = this.queue.length - 1;
            } else {
                this.audio.currentTime = 0;
                return;
            }
        }

        this.currentIndex = prevIndex;
        this.play(this.queue[prevIndex], this.queue, prevIndex);
    },

    seekTo(e) {
        const bar = document.getElementById('progress-bar');
        const rect = bar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        if (this.audio.duration) {
            this.audio.currentTime = percent * this.audio.duration;
        }
    },

    setVolume(e) {
        const bar = document.getElementById('volume-bar');
        const rect = bar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.audio.volume = percent;
        this.volume = percent;
        this.updateVolumeUI();
    },

    toggleMute() {
        if (this.audio.volume > 0) {
            this._prevVolume = this.audio.volume;
            this.audio.volume = 0;
        } else {
            this.audio.volume = this._prevVolume || 0.8;
        }
        this.updateVolumeUI();
    },

    toggleShuffle() {
        this.isShuffle = !this.isShuffle;
        document.getElementById('btn-shuffle').classList.toggle('active', this.isShuffle);
        App.showToast(this.isShuffle ? 'Shuffle on' : 'Shuffle off');
    },

    toggleRepeat() {
        this.repeatMode = (this.repeatMode + 1) % 3;
        const btn = document.getElementById('btn-repeat');
        btn.classList.toggle('active', this.repeatMode > 0);
        const labels = ['Repeat off', 'Repeat all', 'Repeat one'];
        App.showToast(labels[this.repeatMode]);
    },

    // Event handlers
    onPlay() {
        this.isPlaying = true;
        document.getElementById('icon-play').style.display = 'none';
        document.getElementById('icon-pause').style.display = 'block';
    },

    onPause() {
        this.isPlaying = false;
        document.getElementById('icon-play').style.display = 'block';
        document.getElementById('icon-pause').style.display = 'none';
    },

    onSongEnd() {
        if (this.repeatMode === 2) {
            this.audio.currentTime = 0;
            this.audio.play();
        } else {
            this.next();
        }
    },

    onMetadataLoaded() {
        document.getElementById('time-total').textContent = this.formatTime(this.audio.duration);
    },

    onError(e) {
        console.error('Audio error:', e);
        // Try next song
        setTimeout(() => this.next(), 1000);
    },

    // UI Updates
    updateProgress() {
        if (!this.audio.duration) return;
        const percent = (this.audio.currentTime / this.audio.duration) * 100;
        document.getElementById('progress-fill').style.width = percent + '%';
        document.getElementById('time-current').textContent = this.formatTime(this.audio.currentTime);
    },

    updateVolumeUI() {
        const percent = this.audio.volume * 100;
        document.getElementById('volume-fill').style.width = percent + '%';
    },

    updatePlayerUI(song) {
        document.getElementById('player-title').textContent = song.title;
        document.getElementById('player-artist').textContent = song.artist;

        const coverImg = document.getElementById('player-cover-img');
        if (song.cover_url) {
            coverImg.src = song.cover_url;
            coverImg.alt = song.title;
            coverImg.style.display = 'block';
        } else {
            coverImg.src = '';
            coverImg.style.display = 'none';
        }

        // Update like button state
        const isLiked = Favorites.isFavorite(song.id);
        const likeBtn = document.getElementById('player-like');
        likeBtn.classList.toggle('liked', isLiked);

        // Update page title
        document.title = `${song.title} — Saanguh`;
    },

    highlightCurrentSong() {
        // Remove existing highlights
        document.querySelectorAll('.song-row.playing, .song-card.playing').forEach(el => {
            el.classList.remove('playing');
        });

        // Add highlight to current song
        if (this.currentSong) {
            document.querySelectorAll(`[data-song-id="${this.currentSong.id}"]`).forEach(el => {
                el.classList.add('playing');
            });
        }
    },

    updateMediaSession(song) {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: song.title,
                artist: song.artist,
                album: song.album,
                artwork: song.cover_url ? [
                    { src: song.cover_url, sizes: '500x500', type: 'image/jpeg' }
                ] : []
            });

            navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
            navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
        }
    },

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
};
