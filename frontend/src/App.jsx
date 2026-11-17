import { useState } from 'react';
import LoginScreen from './screens/LoginScreen.jsx';
import ReceiptScreen from './screens/ReceiptScreen.jsx';

const SESSION_KEY = 'kantinflow.session';

function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (typeof session?.token === 'string' && session.user) return session;
  } catch {
    // Session yang rusak diperlakukan seperti belum masuk.
  }
  return null;
}

export default function App() {
  const [session, setSession] = useState(readSession);
  const [loginNotice, setLoginNotice] = useState('');

  function handleLogin(data) {
    const next = { token: data.token, user: data.user };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
    } catch {
      // Simpan di memori saja bila sessionStorage tidak tersedia.
    }
    setLoginNotice('');
    setSession(next);
  }

  function handleLogout(message = '') {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Tidak ada yang perlu dibersihkan bila storage tidak tersedia.
    }
    setLoginNotice(message);
    setSession(null);
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} notice={loginNotice} />;
  }
  return <ReceiptScreen session={session} onLogout={handleLogout} />;
}
