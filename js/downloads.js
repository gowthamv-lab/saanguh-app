// ===============================
// Downloads Module
// ===============================

const Downloads = {
    list: [],

    init() {
        this.list = LocalDB.get('downloads') || [];
    },

    add(song) {
        // Prevent duplicates
        if (!this.list.some(s => s.id === song.id)) {
            // Keep at top
            this.list.unshift(song);
            this.save();
        }
    },

    remove(songId) {
        const index = this.list.findIndex(s => s.id === songId);
        if (index !== -1) {
            this.list.splice(index, 1);
            this.save();
        }
        
        // Update downloads page if visible
        if (document.getElementById('page-downloads').classList.contains('active')) {
            App.renderDownloads();
        }
    },

    getAll() {
        return this.list;
    },

    save() {
        LocalDB.set('downloads', this.list);
    }
};
