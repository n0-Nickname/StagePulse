const BASE_URL = import.meta.env.VITE_API_URL || '';

function extractValidationErrors(detailArray) {
  return detailArray.map((err) => {
    const field = Array.isArray(err?.loc)
      ? err.loc.filter((p) => p !== 'body').join('.')
      : '';
    return {
      field,
      type: err?.type || '',
      msg: err?.msg || JSON.stringify(err),
      ctx: err?.ctx || {},
    };
  });
}

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
    let validationErrors = [];

    if (data) {
      if (typeof data.detail === 'string') {
        errorMessage = data.detail;
      } else if (Array.isArray(data.detail)) {
        validationErrors = extractValidationErrors(data.detail);
        errorMessage = validationErrors
          .map((item) => (item.field ? `${item.field}: ${item.msg}` : item.msg))
          .join('; ');
      } else if (data.message) {
        errorMessage = data.message;
      }
    }

    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;
    error.validationErrors = validationErrors;
    throw error;
  }

  return data;
}

export function formatApiError(err, t) {
  if (!err) return t('auth.authFailed');

  const detail = err?.data?.detail;
  const validationErrors =
    Array.isArray(err?.validationErrors) && err.validationErrors.length > 0
      ? err.validationErrors
      : Array.isArray(detail)
      ? extractValidationErrors(detail)
      : [];

  if (err.status === 422 && validationErrors.length > 0) {
    const messages = validationErrors.map((item) => {
      if (item.field === 'email' || item.msg.toLowerCase().includes('email')) {
        return t('auth.errors.invalidEmail');
      }
      if (item.field === 'password') {
        if (item.type === 'string_too_short' || item.msg.toLowerCase().includes('at least')) {
          return t('auth.errors.passwordTooShort');
        }
        return t('auth.errors.passwordRequired');
      }
      return item.field ? `${item.field}: ${item.msg}` : item.msg;
    });
    return messages.join(' ');
  }

  const rawDetail = typeof detail === 'string' ? detail : err.message || '';
  const lower = rawDetail.toLowerCase();

  if (lower.includes('email already registered')) {
    return t('auth.errors.emailAlreadyRegistered');
  }
  if (lower.includes('invalid email or password')) {
    return t('auth.errors.invalidCredentials');
  }
  if (lower.includes('inactive user')) {
    return t('auth.errors.inactiveUser');
  }
  if (lower.includes('no spins remaining')) {
    return t('slots.noSpinsLeft');
  }
  if (err.status === 401 || lower.includes('validate credentials') || lower.includes('not authenticated')) {
    return t('auth.errors.unauthorized');
  }
  if (err.status === 422) {
    return t('auth.errors.validationGeneric');
  }
  if (err.name === 'TypeError' && lower.includes('fetch')) {
    return t('auth.errors.networkError');
  }

  return rawDetail || t('auth.authFailed');
}

export const authApi = {
  register({ email, password }) {
    return apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
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
