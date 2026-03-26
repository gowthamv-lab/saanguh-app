// ===============================
// Favorites Module
// ===============================

const Favorites = {
    list: [],

    init() {
        this.list = LocalDB.get('favorites') || [];
    },

    toggle(song) {
        const index = this.list.findIndex(s => s.id === song.id);
        if (index === -1) {
            this.list.push(song);
            App.showToast('Added to Liked Songs ❤️');
        } else {
            this.list.splice(index, 1);
            App.showToast('Removed from Liked Songs');
        }
        this.save();
        this.updateAllLikeButtons(song.id);

        // Update favorites page if visible
        if (document.getElementById('page-favorites').classList.contains('active')) {
            App.renderFavorites();
        }
    },

    isFavorite(songId) {
        return this.list.some(s => s.id === songId);
    },

    getAll() {
        return this.list;
    },

    save() {
        LocalDB.set('favorites', this.list);
    },

    updateAllLikeButtons(songId) {
        const isLiked = this.isFavorite(songId);

        // Update player like button
        if (Player.currentSong && Player.currentSong.id === songId) {
            document.getElementById('player-like').classList.toggle('liked', isLiked);
        }

        // Update all song row like buttons
        document.querySelectorAll(`[data-like-id="${songId}"]`).forEach(btn => {
            btn.classList.toggle('liked', isLiked);
        });
    }
};
