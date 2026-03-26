// ===============================
// Authentication Module
// ===============================

const Auth = {
    currentUser: null,

    init() {
        // Check for saved user session
        const saved = LocalDB.get('user');
        if (saved) {
            this.currentUser = saved;
            this.updateUI(true);
        }
    },

    signUp(email, password, username) {
        // Local auth for development
        const users = LocalDB.get('users') || [];
        const exists = users.find(u => u.email === email);
        if (exists) {
            throw new Error('An account with this email already exists');
        }

        const user = {
            id: 'user_' + Date.now(),
            email,
            username: username || email.split('@')[0],
            avatar: username ? username[0].toUpperCase() : email[0].toUpperCase(),
            created_at: new Date().toISOString()
        };

        users.push({ ...user, password });
        LocalDB.set('users', users);
        LocalDB.set('user', user);
        this.currentUser = user;
        this.updateUI(true);
        return user;
    },

    signIn(email, password) {
        const users = LocalDB.get('users') || [];
        const user = users.find(u => u.email === email && u.password === password);
        if (!user) {
            throw new Error('Invalid email or password');
        }

        const { password: _, ...userData } = user;
        LocalDB.set('user', userData);
        this.currentUser = userData;
        this.updateUI(true);
        return userData;
    },

    signOut() {
        LocalDB.remove('user');
        this.currentUser = null;
        this.updateUI(false);
    },

    updateUI(isLoggedIn) {
        const userSection = document.getElementById('user-section');
        if (isLoggedIn && this.currentUser) {
            userSection.innerHTML = `
                <div class="user-info">
                    <div class="user-avatar">${this.currentUser.avatar || '?'}</div>
                    <span class="user-name">${this.currentUser.username}</span>
                    <button class="btn-logout" id="btn-logout-action" title="Logout">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    </button>
                </div>
            `;
            document.getElementById('btn-logout-action').addEventListener('click', () => {
                Auth.signOut();
                App.showToast('Logged out successfully');
            });
        } else {
            userSection.innerHTML = `
                <button class="btn-login" id="btn-auth">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    <span>Login / Sign Up</span>
                </button>
            `;
            document.getElementById('btn-auth').addEventListener('click', () => {
                App.showAuthModal();
            });
        }
    }
};
