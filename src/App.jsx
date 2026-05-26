import { useState, useCallback } from 'react';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import { ToastProvider } from './components/Toast';

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem('token'));

  const handleLogin = useCallback(() => setLoggedIn(true), []);
  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setLoggedIn(false);
  }, []);

  if (!loggedIn) return <LoginPage onLogin={handleLogin} />;
  return (
    <ToastProvider>
      <Dashboard onLogout={handleLogout} />
    </ToastProvider>
  );
}
