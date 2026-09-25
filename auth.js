const accountButton = document.querySelector('#accountButton');
const accountAvatar = document.querySelector('#accountAvatar');
const accountLabel = document.querySelector('#accountLabel');
const authGate = document.querySelector('#authGate');
const authGateButton = document.querySelector('#authGateButton');
const authGateTitle = document.querySelector('#authGateTitle');
const authGateCopy = document.querySelector('#authGateCopy');
const authGateStatus = document.querySelector('#authGateStatus');

// Firebase config is intentionally injected separately so the public app can be
// connected to the correct Firebase project without putting project-specific
// credentials in the source code by accident.
const firebaseConfig = window.STORYBOARD_FIREBASE_CONFIG;
const publicReview = new URLSearchParams(location.hash.slice(1)).has('share') || new URLSearchParams(location.hash.slice(1)).has('review');

function setAuthGate(locked, title = '', copy = '', status = '') {
  document.body.classList.toggle('auth-locked', locked);
  if (authGate) authGate.hidden = !locked;
  if (title && authGateTitle) authGateTitle.textContent = title;
  if (copy && authGateCopy) authGateCopy.textContent = copy;
  if (authGateStatus) authGateStatus.textContent = status;
}

function showAuthMessage(message) {
  if (authGateStatus) authGateStatus.textContent = message;
  if (typeof window.showToast === 'function') window.showToast(message);
  else accountButton?.setAttribute('title', message);
}

function renderSignedOut() {
  window.STUDIO_SIGNED_IN = false;
  window.STUDIO_ROLE = null;
  window.STUDIO_USER = null;
  accountAvatar.textContent = 'G';
  accountAvatar.style.backgroundImage = '';
  accountLabel.textContent = 'Iniciar sesión';
  accountButton?.setAttribute('aria-label', 'Iniciar sesión con Google');
  accountButton?.classList.remove('is-authenticated');
  setAuthGate(!publicReview, 'Iniciá sesión para entrar.', 'Tu espacio de preproducción está protegido. Continuá con tu cuenta de Google para ver tus proyectos.');
  window.dispatchEvent(new Event('studio-auth-change'));
}

function renderSignedIn(user, role) {
  window.STUDIO_SIGNED_IN = true;
  window.STUDIO_ROLE = role;
  window.STUDIO_USER = user;
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
  setAuthGate(false);
  window.dispatchEvent(new Event('studio-auth-change'));
}

function renderNoAccess(user) {
  window.STUDIO_SIGNED_IN = false;
  window.STUDIO_ROLE = null;
  window.STUDIO_USER = user;
  accountAvatar.textContent = (user.displayName || user.email || 'G').charAt(0).toUpperCase();
  accountLabel.textContent = user.email || 'Cuenta sin acceso';
  accountButton?.setAttribute('aria-label', 'Cerrar sesión');
  setAuthGate(!publicReview, 'Esta cuenta no tiene acceso.', 'Pedile al administrador de GB Studio que habilite tu correo de Google para entrar al estudio.');
  window.dispatchEvent(new Event('studio-auth-change'));
}

if (!firebaseConfig?.apiKey || !firebaseConfig?.authDomain || !firebaseConfig?.projectId) {
  renderSignedOut();
  setAuthGate(true, 'No se pudo conectar el acceso.', 'La configuración de Firebase no está disponible en esta versión publicada.', 'Revisá la conexión del proyecto e intentá nuevamente.');
  const missingConfigMessage = () => showAuthMessage('No se pudo cargar la configuración de Firebase. Recargá la página e intentá nuevamente.');
  accountButton?.addEventListener('click', missingConfigMessage);
  authGateButton?.addEventListener('click', missingConfigMessage);
} else {
  try {
    const [{ initializeApp }, { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut }, cloud] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js'),
      import('./reviews-cloud.js?v=2'),
    ]);
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    let stopRoleWatch = null;
    window.STUDIO_CLOUD = cloud;
    onAuthStateChanged(auth, user => {
      stopRoleWatch?.(); stopRoleWatch = null;
      if (!user || user.isAnonymous) { renderSignedOut(); return; }
      const google = user.emailVerified && user.providerData.some(item => item.providerId === 'google.com');
      if (!google) { renderNoAccess(user); return; }
      if (user.email?.toLowerCase() === 'info@granbertafilms.com') { renderSignedIn(user, 'admin'); return; }
      if (!publicReview) setAuthGate(true, 'Verificando acceso…', 'Estamos comprobando si tu cuenta está autorizada para entrar al estudio.');
      stopRoleWatch = cloud.watchStaffRole(user, role => {
        if (auth.currentUser?.uid !== user.uid) return;
        role ? renderSignedIn(user, role) : renderNoAccess(user);
      }, error => {
        if (auth.currentUser?.uid !== user.uid) return;
        console.error('Could not verify studio access', error);
        renderNoAccess(user);
        if (!publicReview) setAuthGate(true, 'No se pudo verificar el acceso.', 'Revisá la conexión con Firebase e intentá nuevamente.');
      });
    });
    const signIn = async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        console.error('Google sign-in failed', error);
        const code = error?.code || '';
        if (code.includes('operation-not-allowed')) showAuthMessage('Activá Google en Firebase → Authentication → Sign-in method.');
        else if (code.includes('unauthorized-domain')) showAuthMessage('Agregá gb-films.github.io en Firebase → Authentication → Authorized domains.');
        else if (code.includes('popup-blocked')) showAuthMessage('El navegador bloqueó la ventana de Google. Permití ventanas emergentes para este sitio.');
        else showAuthMessage('No se pudo iniciar sesión con Google. Revisá la configuración de Firebase.');
      }
    };
    accountButton?.addEventListener('click', async () => {
      if (auth.currentUser) await signOut(auth);
      else await signIn();
    });
    authGateButton?.addEventListener('click', signIn);
  } catch (error) {
    console.error('Firebase auth could not be initialized', error);
    renderSignedOut();
    setAuthGate(true, 'No se pudo cargar el acceso.', 'Firebase no respondió correctamente. Recargá la página e intentá nuevamente.', 'Si el problema continúa, revisá la configuración del proveedor Google.');
    const initErrorMessage = () => showAuthMessage('No se pudo cargar el acceso con Google. Recargá la página e intentá nuevamente.');
    accountButton?.addEventListener('click', initErrorMessage);
    authGateButton?.addEventListener('click', initErrorMessage);
  }
}
