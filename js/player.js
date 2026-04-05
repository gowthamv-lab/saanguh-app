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
    _fallbackLevel: 0, // 0=none, 1=full fallback tried, 2=title-only tried

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

        // Expanded mobile player handling
        const playerBar = document.getElementById('player-bar');
        const collapseBtn = document.getElementById('btn-collapse-player');

        playerBar.addEventListener('click', (e) => {
            // Expand on mobile if clicking the bar itself (but not controls or buttons)
            if (window.innerWidth <= 768 && !e.target.closest('button, .progress-bar, .volume-control, .player-extra')) {
                playerBar.classList.add('expanded');
            }
        });

        if (collapseBtn) {
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                playerBar.classList.remove('expanded');
            });
        }

        // Queue Panel handling
        const queueBtn = document.getElementById('btn-queue');
        const closeQueueBtn = document.getElementById('btn-close-queue');
        const queuePanel = document.getElementById('queue-panel');

        if (queueBtn && queuePanel) {
            queueBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (queuePanel.classList.contains('open')) {
                    queuePanel.classList.remove('open');
                } else {
                    queuePanel.classList.add('open');
                    this.renderQueue();
                }
            });
        }

        if (closeQueueBtn) {
            closeQueueBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                queuePanel.classList.remove('open');
            });
        }

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

    // ─── Play a song ──────────────────────────────────────────
    play(song, queue = null, index = -1) {
        if (!song || !song.audio_url) {
            // No audio URL at all — try multi-source fallback immediately
            if (song && song.title) {
                console.log('No audio_url, trying multi-source fallback for:', song.title);
                this._fallbackLevel = 0;
                this._tryFallback(song, queue, index);
                return;
            }
            // Absolutely nothing to play — silently skip
            App.showToast('Skipping to next song...');
            setTimeout(() => this.next(), 500);
            return;
        }

        this.currentSong = song;
        this._fallbackLevel = 0; // Reset for new song
        this._originalSong = { ...song }; // Keep original for retries
        if (queue) {
            this.queue = queue;
            this.currentIndex = index;
        }

        this.audio.src = song.audio_url;
        this.audio.play().catch(err => {
            console.error('Play error:', err);
            this._tryFallback(this._originalSong || song, this.queue, this.currentIndex);
        });

        // Update UI
        this.updatePlayerUI(song);
        Songs.addToRecent(song);
        this.highlightCurrentSong();
        this.updateMediaSession(song);
    },

    // ─── Multi-Source Fallback Chain ─────────────────────────
    // Level 0→1: Try server /api/fallback/stream (cascades through
    //            YouTube Music → YouTube → SoundCloud with full query)
    // Level 1→2: Try again with title-only query (broader search)
    // Level 2+:  Give up, auto-skip to next song
    //
    // The server itself tries MULTIPLE sources and query variants
    // internally, so each client call already covers a LOT of ground.
    // ─────────────────────────────────────────────────────────────
    async _tryFallback(song, queue, index) {
        this._fallbackLevel++;

        if (this._fallbackLevel > 2) {
            // All levels exhausted — silently skip to next
            console.log('All fallback levels exhausted, auto-skipping...');
            App.showToast('Skipping to next... ⏭️');
            setTimeout(() => this.next(), 800);
            return;
        }

        const title = encodeURIComponent(song.title || '');
        const artist = encodeURIComponent(song.artist || '');

        // Level 1: full query (title + artist)
        // Level 2: title-only (broader match)
        let fallbackUrl;
        let toastMsg;
        if (this._fallbackLevel === 1) {
            fallbackUrl = `/api/fallback/stream?title=${title}&artist=${artist}`;
            toastMsg = 'Searching alternate sources... 🔄';
        } else {
            fallbackUrl = `/api/fallback/stream?title=${title}`;
            toastMsg = 'Broadening search... 🔍';
        }

        console.log(`🔄 Fallback Level ${this._fallbackLevel} for: ${song.title}`);
        App.showToast(toastMsg);

        // Update the song object with fallback URL
        const fallbackSong = { ...song, audio_url: fallbackUrl };
        this.currentSong = fallbackSong;
        if (queue) {
            this.queue = queue;
            this.currentIndex = index;
        }
        if (queue && index >= 0 && index < queue.length) {
            queue[index] = fallbackSong;
        }

        this.audio.src = fallbackUrl;
        try {
            await this.audio.play();
            console.log(`✅ Fallback Level ${this._fallbackLevel} playback started!`);
            App.showToast('Playing from alternate source ✅');
        } catch (err) {
            console.error(`Fallback Level ${this._fallbackLevel} failed:`, err);
            // Recursively try next level
            this._tryFallback(song, queue, index);
            return;
        }

        this.updatePlayerUI(fallbackSong);
        this.highlightCurrentSong();
        this.updateMediaSession(fallbackSong);
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
            this.updatePositionState();
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
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
            this.updatePositionState();
        }
    },

    onPause() {
        this.isPlaying = false;
        document.getElementById('icon-play').style.display = 'block';
        document.getElementById('icon-pause').style.display = 'none';
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
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
        this.updatePositionState();
    },

    onError(e) {
        console.error('Audio stream error:', e);
        // Try multi-source fallback (uses _fallbackLevel to avoid infinite loops)
        if (this.currentSong && this._fallbackLevel < 2) {
            const originalSong = this._originalSong || this.currentSong;
            console.log(`Stream error at level ${this._fallbackLevel}, retrying:`, originalSong.title);
            this._tryFallback(originalSong, this.queue, this.currentIndex);
        } else {
            // All sources failed — silently skip to next
            console.log('All sources failed, skipping...');
            App.showToast('Skipping to next... ⏭️');
            setTimeout(() => this.next(), 800);
        }
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

    renderQueue() {
        const queueList = document.getElementById('queue-list');
        if (!queueList) return;

        if (this.queue.length === 0) {
            queueList.innerHTML = '<div class="empty-state"><p>Queue is empty</p></div>';
            return;
        }

        const startIndex = Math.max(0, this.currentIndex);
        const upcomingSongs = this.queue.slice(startIndex, startIndex + 20); // show next 20

        queueList.innerHTML = upcomingSongs.map((song, i) => `
            <div class="song-row ${i === 0 ? 'playing' : ''}" style="grid-template-columns: 1fr auto; padding: 10px; cursor: pointer;" onclick="event.stopPropagation(); Player.play(Player.queue[${startIndex + i}], Player.queue, ${startIndex + i}); document.getElementById('queue-panel').classList.remove('open');">
                <div class="song-row-info">
                    <div class="song-row-cover" style="width:36px; height:36px; border-radius:4px; overflow:hidden; background:var(--bg-glass);">
                        ${song.cover_url ? `<img src="${song.cover_url}" alt="" style="width:100%;height:100%;object-fit:cover;">` : ''}
                    </div>
                    <div class="song-row-text" style="margin-left: 10px;">
                        <div class="song-row-title" style="font-size:0.9rem">${song.title}</div>
                        <div class="song-row-artist" style="font-size:0.8rem; color:var(--text-secondary);">${song.artist}</div>
                    </div>
                </div>
            </div>
        `).join('');
    },

    updateMediaSession(song) {
        try {
            if ('mediaSession' in navigator && window.MediaMetadata) {
                // Build artwork array - only include if cover_url exists and is valid
                const artwork = [];
                if (song.cover_url && song.cover_url.length > 0) {
                    artwork.push({ src: song.cover_url, sizes: '512x512' });
                    artwork.push({ src: song.cover_url, sizes: '256x256' });
                    artwork.push({ src: song.cover_url, sizes: '192x192' });
                    artwork.push({ src: song.cover_url, sizes: '96x96' });
                }

                const metadata = new MediaMetadata({
                    title: song.title || 'Unknown',
                    artist: song.artist || 'Unknown Artist',
                    album: song.album || 'Saanguh',
                    artwork: artwork
                });

                navigator.mediaSession.metadata = metadata;
                console.log('MediaSession metadata set:', song.title, '| artwork:', artwork.length > 0 ? song.cover_url : 'none');

                // Set action handlers
                const safeSetAction = (action, handler) => {
                    try {
                        navigator.mediaSession.setActionHandler(action, handler);
                    } catch (e) {
                        console.warn(`MediaSession action ${action} not supported`);
                    }
                };

                safeSetAction('play', () => {
                    this.audio.play();
                });
                safeSetAction('pause', () => {
                    this.audio.pause();
                });
                safeSetAction('previoustrack', () => this.previous());
                safeSetAction('nexttrack', () => this.next());
                
                safeSetAction('seekbackward', (details) => {
                    const skipTime = details.seekOffset || 10;
                    this.audio.currentTime = Math.max(this.audio.currentTime - skipTime, 0);
                    this.updatePositionState();
                });
                safeSetAction('seekforward', (details) => {
                    const skipTime = details.seekOffset || 10;
                    this.audio.currentTime = Math.min(this.audio.currentTime + skipTime, this.audio.duration);
                    this.updatePositionState();
                });
                safeSetAction('seekto', (details) => {
                    if (details.fastSeek && 'fastSeek' in this.audio) {
                      this.audio.fastSeek(details.seekTime);
                    } else {
                      this.audio.currentTime = details.seekTime;
                    }
                    this.updatePositionState();
                });

                // Set initial playback state
                navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
            }
        } catch (e) {
            console.error('MediaSession error:', e);
        }
    },

    updatePositionState() {
        if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            if (this.audio && this.audio.duration && !isNaN(this.audio.duration)) {
                navigator.mediaSession.setPositionState({
                    duration: this.audio.duration,
                    playbackRate: this.audio.playbackRate || 1,
                    position: this.audio.currentTime
                });
            }
        }
    },

    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
};
