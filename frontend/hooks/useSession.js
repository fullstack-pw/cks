// frontend/hooks/useSession.js - Hook for managing session data

import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';

// API fetcher function
const fetcher = async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
        const error = new Error('Failed to fetch data');
        error.status = response.status;
        throw error;
    }
    return response.json();
};

export function useSession(sessionId) {
    // Use SWR for data fetching with periodic polling
    const { data, error, mutate } = useSWR(
        sessionId ? `/api/v1/sessions/${sessionId}` : null,
        fetcher,
        {
            refreshInterval: 10000, // Refresh every 10 seconds
            revalidateOnFocus: true,
            dedupingInterval: 5000,
        }
    );

    // Create a new session
    const createSession = useCallback(async (scenarioId) => {
        try {
            const response = await fetch('/api/v1/sessions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ scenarioId }),
            });

            if (!response.ok) {
                throw new Error('Failed to create session');
            }

            const result = await response.json();
            return result;
        } catch (error) {
            throw error;
        }
    }, []);

    // Delete a session
    const deleteSession = useCallback(async (id) => {
        try {
            const response = await fetch(`/api/v1/sessions/${id}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                throw new Error('Failed to delete session');
            }

            return true;
        } catch (error) {
            throw error;
        }
    }, []);

    // Extend a session
    const extendSession = useCallback(async (id, minutes = 30) => {
        try {
            const response = await fetch(`/api/v1/sessions/${id}/extend`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ minutes }),
            });

            if (!response.ok) {
                throw new Error('Failed to extend session');
            }

            // Refresh session data
            mutate();
            return true;
        } catch (error) {
            throw error;
        }
    }, [mutate]);

    // Validate a task
    const validateTask = useCallback(async (taskId) => {
        try {
            const response = await fetch(`/api/v1/sessions/${sessionId}/tasks/${taskId}/validate`, {
                method: 'POST',
            });

            if (!response.ok) {
                throw new Error('Task validation failed');
            }

            const result = await response.json();

            // Refresh session data to update task status
            mutate();

            return result;
        } catch (error) {
            throw error;
        }
    }, [sessionId, mutate]);

    return {
        session: data,
        isLoading: !error && !data,
        isError: error,
        createSession,
        deleteSession,
        extendSession,
        validateTask,
        refresh: mutate,
    };
}

export default useSession;