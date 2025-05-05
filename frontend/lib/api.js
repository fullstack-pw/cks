// frontend/lib/api.js - API client for backend communication

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';

class ApiError extends Error {
    constructor(message, status, info) {
        super(message);
        this.status = status;
        this.info = info;
        this.name = 'ApiError';
    }
}

export const api = {
    async fetchJson(url, options = {}) {
        const response = await fetch(`${API_BASE_URL}${url}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (!response.ok) {
            const error = new ApiError(
                `API request failed: ${response.status} ${response.statusText}`,
                response.status
            );

            try {
                error.info = await response.json();
            } catch (e) {
                error.info = { message: response.statusText };
            }

            throw error;
        }

        // Return null for 204 No Content
        if (response.status === 204) {
            return null;
        }

        return response.json();
    },

    // Session endpoints
    sessions: {
        create: (scenarioId) => api.fetchJson('/sessions', {
            method: 'POST',
            body: JSON.stringify({ scenarioId })
        }),

        get: (id) => api.fetchJson(`/sessions/${id}`),

        list: () => api.fetchJson('/sessions'),

        delete: (id) => api.fetchJson(`/sessions/${id}`, {
            method: 'DELETE'
        }),

        extend: (id, minutes = 30) => api.fetchJson(`/sessions/${id}/extend`, {
            method: 'PUT',
            body: JSON.stringify({ minutes })
        })
    },

    // Scenario endpoints
    scenarios: {
        list: (params = {}) => {
            const queryParams = new URLSearchParams();
            if (params.category) queryParams.append('category', params.category);
            if (params.difficulty) queryParams.append('difficulty', params.difficulty);
            if (params.search) queryParams.append('search', params.search);

            const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
            return api.fetchJson(`/scenarios${query}`);
        },

        get: (id) => api.fetchJson(`/scenarios/${id}`),

        categories: () => api.fetchJson('/scenarios/categories')
    },

    // Terminal endpoints
    terminals: {
        create: (sessionId, target) => api.fetchJson(`/sessions/${sessionId}/terminals`, {
            method: 'POST',
            body: JSON.stringify({ target })
        }),

        resize: (terminalId, rows, cols) => api.fetchJson(`/terminals/${terminalId}/resize`, {
            method: 'POST',
            body: JSON.stringify({ rows, cols })
        }),

        close: (terminalId) => api.fetchJson(`/terminals/${terminalId}`, {
            method: 'DELETE'
        })
    },

    // Task endpoints
    tasks: {
        validate: (sessionId, taskId) => api.fetchJson(`/sessions/${sessionId}/tasks/${taskId}/validate`, {
            method: 'POST'
        })
    }
};

// WebSocket connection for terminal
export const createTerminalConnection = (terminalId) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WebSocket(`${protocol}//${window.location.host}${API_BASE_URL}/terminals/${terminalId}/attach`);
};

export default api;