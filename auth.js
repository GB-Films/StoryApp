const accountButton = document.querySelector('#accountButton');
const accountAvatar = document.querySelector('#accountAvatar');
const accountLabel = document.querySelector('#accountLabel');

// Firebase config is intentionally injected separately so the public app can be
// connected to the correct Firebase project without putting project-specific
// credentials in the source code by accident.
const firebaseConfig = window.STORYBOARD_FIREBASE_CONFIG;

function showAuthMessage(message) {
  if (typeof window.showToast === 'function') window.showToast(message);
  else accountButton?.setAttribute('title', message);
}

function renderSignedOut() {
  accountAvatar.textContent = 'G';
  accountAvatar.style.backgroundImage = '';
  accountLabel.textContent = 'Iniciar sesión';
  accountButton?.setAttribute('aria-label', 'Iniciar sesión con Google');
  accountButton?.classList.remove('is-authenticated');
}

function renderSignedIn(user) {
  const name = user.displayName || user.email || 'Cuenta';
  accountLabel.textContent = name;
  accountButton?.setAttribute('aria-label', `Cerrar sesión de ${name}`);
  accountButton?.classList.add('is-authenticated');
  if (user.photoURL) {
    accountAvatar.textContent = '';
    accountAvatar.style.backgroundImage = `url("${user.photoURL.replaceAll('"', '')}")`;
  } else {
    accountAvatar.textContent = name.trim().charAt(0).toUpperCase() || 'G';
    accountAvatar.style.backgroundImage = '';
  }
}

if (!firebaseConfig?.apiKey || !firebaseConfig?.authDomain || !firebaseConfig?.projectId) {
  renderSignedOut();
  accountButton?.addEventListener('click', () => showAuthMessage('Falta conectar este proyecto con Firebase para iniciar sesión con Google.'));
} else {
  try {
    const [{ initializeApp }, { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js'),
    ]);
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    onAuthStateChanged(auth, user => user ? renderSignedIn(user) : renderSignedOut());
    accountButton?.addEventListener('click', async () => {
      try {
        if (auth.currentUser) await signOut(auth);
        else await signInWithPopup(auth, provider);
      } catch (error) {
        console.error('Google sign-in failed', error);
        showAuthMessage('No se pudo iniciar sesión con Google. Revisá la configuración de Firebase.');
      }
    });
  } catch (error) {
    console.error('Firebase auth could not be initialized', error);
    renderSignedOut();
    accountButton?.addEventListener('click', () => showAuthMessage('No se pudo cargar el acceso con Google.'));
  }
}
