const TaskFlow = (() => {
  const API_URL = 'https://script.google.com/macros/s/AKfycbzzSe21NDOkq9ZaBRsUSnQYgZACsr7Uu8607w5Bmu6ZDFDU63AUg3uDKCZg1at-uLIrSA/exec';
  const TOKEN_KEY = 'taskFlowToken';
  const USER_KEY = 'taskFlowUser';

  function token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  function saveSession(payload) {
    localStorage.setItem(TOKEN_KEY, payload.token);
    localStorage.setItem(USER_KEY, JSON.stringify(payload.user || {}));
  }

  function saveUser(nextUser) {
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser || {}));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function request(action, params) {
    return new Promise((resolve, reject) => {
      const callbackName = `taskFlowCallback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const script = document.createElement('script');
      const query = new URLSearchParams(Object.assign({ action, callback: callbackName }, params || {})).toString();

      window[callbackName] = (payload) => {
        delete window[callbackName];
        script.remove();
        if (!payload.ok) {
          reject(new Error(payload.error || '请求失败'));
          return;
        }
        resolve(payload.result);
      };

      script.onerror = () => {
        delete window[callbackName];
        script.remove();
        reject(new Error('无法连接 Apps Script 后端'));
      };

      script.src = `${API_URL}?${query}`;
      document.body.appendChild(script);
    });
  }

  async function login(username, password) {
    const result = await request('login', { username, password });
    saveSession(result);
    return result;
  }

  async function logout() {
    const currentToken = token();
    clearSession();
    if (currentToken) {
      try {
        await request('logout', { token: currentToken });
      } catch (error) {
        // Logging out locally is enough for the next page transition.
      }
    }
  }

  function dashboard() {
    return request('getDashboardData', { token: token() });
  }

  function createTask(payload) {
    return request('createTask', {
      token: token(),
      payload: JSON.stringify(payload || {}),
    });
  }

  function acceptTask(taskId, payload) {
    return request('acceptTask', {
      token: token(),
      taskId,
      payload: JSON.stringify(payload || {}),
    });
  }

  function rejectTask(taskId, note) {
    return request('rejectTask', {
      token: token(),
      taskId,
      note: note || '',
    });
  }

  function confirmReceipt(taskId, note) {
    return request('confirmReceipt', {
      token: token(),
      taskId,
      note: note || '',
    });
  }

  function searchHistory(keyword) {
    return request('searchHistory', {
      token: token(),
      keyword: keyword || '',
    });
  }

  async function uploadTransferProof(taskId, file, dataUrl) {
    const compressed = await compressImage(dataUrl);
    return request('uploadTransferProof', {
      token: token(),
      taskId,
      name: file.name,
      mimeType: 'image/jpeg',
      data: compressed,
    });
  }

  function compressImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 1200;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      image.onerror = () => reject(new Error('图片处理失败'));
      image.src = dataUrl;
    });
  }

  function requireLogin() {
    if (!token()) {
      location.href = 'index.html';
      return false;
    }
    return true;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatTimer(startText) {
    const start = parseDate(startText);
    if (!start) return { label: '', color: '' };
    const minutes = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000));
    return {
      label: `${minutes} 分钟`,
      color: minutes <= 10 ? 'green' : minutes <= 20 ? 'yellow' : 'red',
    };
  }

  function toast(message) {
    const box = document.getElementById('toast');
    if (!box) return;
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => box.classList.remove('show'), 2600);
  }

  function setLoading(isLoading) {
    document.querySelectorAll('button').forEach((button) => {
      button.disabled = isLoading;
    });
  }

  function currentUserLabel() {
    const current = user() || {};
    return `${escapeHtml(current.name || current.username || '')} / ${escapeHtml(current.role || '')}`;
  }

  return {
    token,
    user,
    saveUser,
    clearSession,
    login,
    logout,
    dashboard,
    createTask,
    acceptTask,
    rejectTask,
    confirmReceipt,
    searchHistory,
    uploadTransferProof,
    requireLogin,
    escapeHtml,
    escapeAttr,
    formatTimer,
    toast,
    setLoading,
    currentUserLabel,
  };
})();
