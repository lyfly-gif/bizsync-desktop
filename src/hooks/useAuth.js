import { useState, useCallback, useEffect } from 'react';
import api from '../api/client';

export function useAuth() {
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  });
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (username, password) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { username, password });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
      return data.user;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    api.get('/auth/me').then(({ data }) => {
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
    }).catch((err) => { console.error('Token 验证失败:', err); });
  }, []);

  return { user, login, logout, loading };
}
