const BASE_URL = import.meta.env.VITE_API_URL || '';

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('pt_token');
  const normalizedPath = path.startsWith('/api')
    ? path
    : `/api${path.startsWith('/') ? path : `/${path}`}`;

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${normalizedPath}`, {
    ...options,
    headers,
  });

  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    const text = await response.text();
    data = text ? { detail: text } : null;
  }

  if (!response.ok) {
    let errorMessage = `Request failed (${response.status})`;
    if (data) {
      if (typeof data.detail === 'string') {
        errorMessage = data.detail;
      } else if (Array.isArray(data.detail)) {
        errorMessage = data.detail
          .map((err) => {
            const field = Array.isArray(err.loc)
              ? err.loc.filter((p) => p !== 'body').join('.')
              : '';
            const msg = err.msg || JSON.stringify(err);
            return field ? `${field}: ${msg}` : msg;
          })
          .join('; ');
      } else if (data.message) {
        errorMessage = data.message;
      }
    }
    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const authApi = {
  register({ email, username, password }) {
    return apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password }),
    });
  },
  login({ email, password }) {
    return apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  me() {
    return apiFetch('/api/auth/me', {
      method: 'GET',
    });
  },
};

export const slotsApi = {
  spin() {
    return apiFetch('/api/slots/spin', {
      method: 'POST',
    });
  },
};

export const presentationsApi = {
  create(payload) {
    return apiFetch('/api/presentations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  list() {
    return apiFetch('/api/presentations', {
      method: 'GET',
    });
  },
};
