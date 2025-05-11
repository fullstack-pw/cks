// frontend/lib/api.js (enhanced version)

import ErrorHandler from '../utils/errorHandler';

// Use environment variable with fallback to localhost
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
const DEFAULT_TIMEOUT = 30000; // 30 seconds default timeout

/**
 * Enhanced API client for the CKS application
 */
class ApiClient {
    /**
     * Performs a fetch request with standardized error handling
     * @param {string} url - API endpoint path
     * @param {Object} options - Fetch options
     * @param {number} timeout - Request timeout in ms
     * @returns {Promise<any>} - Parsed response
     */
    async fetchWithTimeout(url, options = {}, timeout = DEFAULT_TIMEOUT) {
        const controller = new AbortController();
        const { signal } = controller;

        // Set up timeout
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, timeout);

        try {
            const response = await fetch(`${API_BASE_URL}${url}`, {
                ...options,
                signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            // Clear timeout since request completed
            clearTimeout(timeoutId);

            // Handle HTTP errors
            if (!response.ok) {
                const error = new Error(`API request failed: ${response.status} ${response.statusText}`);
                error.status = response.status;
                error.url = url;
                error.method = options.method || 'GET';

                try {
                    error.info = await response.json();
                } catch (e) {
                    error.info = { message: response.statusText };
                }

                // Process through error handler
                throw ErrorHandler.processApiError(error, `api:${url}`);
            }

            // Return null for 204 No Content
            if (response.status === 204) {
                return null;
            }

            return response.json();
        } catch (error) {
            // Clear timeout if there's an error
            clearTimeout(timeoutId);

            // Handle abort error (timeout)
            if (error.name === 'AbortError') {
                const timeoutError = new Error(`Request timed out after ${timeout}ms`);
                timeoutError.status = 408; // Request Timeout
                timeoutError.isTimeout = true;
                timeoutError.url = url;

                // Process through error handler
                throw ErrorHandler.processApiError(timeoutError, `api:${url}:timeout`);
            }

            // If error is already processed, rethrow it
            if (error.hasBeenProcessed) {
                throw error;
            }

            // Enhance error with more context
            error.endpoint = url;
            error.requestOptions = { ...options, body: options.body ? '[REDACTED]' : undefined };

            // Process through error handler
            throw ErrorHandler.processApiError(error, `api:${url}`);
        }
    }

    /**
     * Performs a request with retry capability for network errors
     * @param {string} url - API endpoint path
     * @param {Object} options - Fetch options
     * @param {number} retries - Number of retries for network errors
     * @param {number} timeout - Request timeout in ms
     * @returns {Promise<any>} - Parsed response
     */
    async fetchWithRetry(url, options = {}, retries = 2, timeout = DEFAULT_TIMEOUT) {
        try {
            return await this.fetchWithTimeout(url, options, timeout);
        } catch (error) {
            // Only retry for network errors and timeouts, not HTTP errors
            if (retries > 0 && (error.name === 'TypeError' || error.isTimeout)) {
                console.log(`Retrying API call to ${url}, ${retries} attempts left`);
                // Exponential backoff
                const delay = 1000 * Math.pow(2, 3 - retries);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.fetchWithRetry(url, options, retries - 1, timeout);
            }
            throw error;
        }
    }

    // Session endpoints
    sessions = {
        /**
         * Create a new session
         * @param {string} scenarioId - ID of the scenario
         * @returns {Promise<Object>} - Session data
         */
        create: (scenarioId) => this.fetchWithRetry('/sessions', {
            method: 'POST',
            body: JSON.stringify({ scenarioId })
        }),

        /**
         * Get session details
         * @param {string} id - Session ID
         * @returns {Promise<Object>} - Session data
         */
        get: (id) => this.fetchWithRetry(`/sessions/${id}`),

        /**
         * List all sessions
         * @returns {Promise<Array>} - List of sessions
         */
        list: () => this.fetchWithRetry('/sessions'),

        /**
         * Delete a session
         * @param {string} id - Session ID
         * @returns {Promise<null>} - Success indicator
         */
        delete: (id) => this.fetchWithRetry(`/sessions/${id}`, {
            method: 'DELETE'
        }),

        /**
         * Extend a session's expiration time
         * @param {string} id - Session ID
         * @param {number} minutes - Minutes to extend
         * @returns {Promise<Object>} - Updated session data
         */
        extend: (id, minutes = 30) => this.fetchWithRetry(`/sessions/${id}/extend`, {
            method: 'PUT',
            body: JSON.stringify({ minutes })
        }),

        /**
         * Get tasks for a session
         * @param {string} id - Session ID
         * @returns {Promise<Array>} - List of tasks
         */
        getTasks: (id) => this.fetchWithRetry(`/sessions/${id}/tasks`)
    };

    // Scenario endpoints
    scenarios = {
        /**
         * List scenarios with optional filtering
         * @param {Object} params - Filter parameters
         * @returns {Promise<Array>} - List of scenarios
         */
        list: (params = {}) => {
            const queryParams = new URLSearchParams();
            if (params.category) queryParams.append('category', params.category);
            if (params.difficulty) queryParams.append('difficulty', params.difficulty);
            if (params.search) queryParams.append('search', params.search);

            const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
            return this.fetchWithRetry(`/scenarios${query}`);
        },

        /**
         * Get scenario details
         * @param {string} id - Scenario ID
         * @returns {Promise<Object>} - Scenario data
         */
        get: (id) => this.fetchWithRetry(`/scenarios/${id}`),

        /**
         * Get scenario categories
         * @returns {Promise<Object>} - Categories mapping
         */
        categories: () => this.fetchWithRetry('/scenarios/categories')
    };

    // Terminal endpoints
    terminals = {
        /**
         * Create a terminal session
         * @param {string} sessionId - Session ID
         * @param {string} target - Terminal target (control-plane or worker-node)
         * @returns {Promise<Object>} - Terminal session data
         */
        create: (sessionId, target) => this.fetchWithRetry(`/sessions/${sessionId}/terminals`, {
            method: 'POST',
            body: JSON.stringify({ target })
        }),

        /**
         * Resize a terminal
         * @param {string} terminalId - Terminal ID
         * @param {number} rows - Number of rows
         * @param {number} cols - Number of columns
         * @returns {Promise<Object>} - Success indicator
         */
        resize: (terminalId, rows, cols) => this.fetchWithRetry(`/terminals/${terminalId}/resize`, {
            method: 'POST',
            body: JSON.stringify({ rows, cols })
        }, 1), // Only retry once for resize to avoid flooding

        /**
         * Close a terminal session
         * @param {string} terminalId - Terminal ID
         * @returns {Promise<null>} - Success indicator
         */
        close: (terminalId) => this.fetchWithRetry(`/terminals/${terminalId}`, {
            method: 'DELETE'
        })
    };

    // Task endpoints
    tasks = {
        /**
         * Validate a task
         * @param {string} sessionId - Session ID
         * @param {string} taskId - Task ID
         * @returns {Promise<Object>} - Validation results
         */
        validate: (sessionId, taskId) => this.fetchWithRetry(`/sessions/${sessionId}/tasks/${taskId}/validate`, {
            method: 'POST'
        }, 1, 60000) // Longer timeout for validation (60s) with 1 retry
    };
}

/**
 * Create WebSocket connection for terminal
 * @param {string} terminalId - Terminal ID
 * @returns {WebSocket} - WebSocket connection
 */
export const createTerminalConnection = (terminalId) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    // Create the correct WebSocket URL
    const wsPath = `/api/v1/terminals/${terminalId}/attach`;
    const wsUrl = `${protocol}//${host}${wsPath}`;

    console.log(`Creating WebSocket connection to: ${wsUrl}`);
    return new WebSocket(wsUrl);
};

// Create and export a singleton instance
const api = new ApiClient();
export default api;