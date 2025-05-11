// frontend/contexts/SessionContext.js - Add toast notifications

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { mutate } from 'swr';
import { useToast } from './ToastContext';
import api from '../lib/api';

// Create context
const SessionContext = createContext(null);

// Context provider component
export const SessionProvider = ({ children }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const router = useRouter();
    const toast = useToast(); // Add toast

    // Global fetcher function for SWR
    const fetcher = async (url) => {
        try {
            return await api.sessions.get(url.split('/').pop());
        } catch (err) {
            setError(err);
            throw err;
        }
    };

    // Create a new session
    const createSession = async (scenarioId) => {
        setLoading(true);
        setError(null);

        try {
            const result = await api.sessions.create(scenarioId);
            // Prefetch the session data for SWR
            mutate(`/sessions/${result.sessionId}`, result, false);
            toast.success('Lab session created successfully');
            router.push(`/lab/${result.sessionId}`);
            return result;
        } catch (err) {
            setError(err);
            toast.error(`Failed to create session: ${err.message || 'Unknown error'}`);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Delete a session
    const deleteSession = async (sessionId) => {
        setLoading(true);
        setError(null);

        try {
            await api.sessions.delete(sessionId);
            // Invalidate the cache for this session
            mutate(`/sessions/${sessionId}`, null, false);
            toast.success('Session deleted successfully');
            router.push('/');
        } catch (err) {
            setError(err);
            toast.error(`Failed to delete session: ${err.message || 'Unknown error'}`);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Extend a session
    const extendSession = async (sessionId, minutes = 30) => {
        setLoading(true);
        setError(null);

        try {
            await api.sessions.extend(sessionId, minutes);
            // Revalidate to get updated session data
            mutate(`/sessions/${sessionId}`);
            toast.success(`Session extended by ${minutes} minutes`);
            return true;
        } catch (err) {
            setError(err);
            toast.error(`Failed to extend session: ${err.message || 'Unknown error'}`);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Validate a task
    const validateTask = async (sessionId, taskId) => {
        setLoading(true);
        setError(null);

        try {
            const result = await api.tasks.validate(sessionId, taskId);
            // Revalidate to get updated session data
            mutate(`/sessions/${sessionId}`);

            if (result.success) {
                toast.success('Task completed successfully!');
            } else {
                toast.warning('Task validation failed');
            }

            return result;
        } catch (err) {
            setError(err);
            toast.error(`Validation error: ${err.message || 'Unknown error'}`);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Create a terminal session
    const createTerminal = async (sessionId, target) => {
        try {
            const result = await api.terminals.create(sessionId, target);
            toast.success(`Terminal created for ${target}`);
            return result;
        } catch (err) {
            setError(err);
            toast.error(`Failed to create terminal: ${err.message || 'Unknown error'}`);
            throw err;
        }
    };

    // The context value
    const value = {
        // State
        loading,
        error,

        // Actions
        createSession,
        deleteSession,
        extendSession,
        validateTask,
        createTerminal,

        // Helper for components to use SWR directly
        fetcher
    };

    return (
        <SessionContext.Provider value={value}>
            {children}
        </SessionContext.Provider>
    );
};

// Custom hook to use the session context
export const useSessionContext = () => {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error('useSessionContext must be used within a SessionProvider');
    }
    return context;
};

export default SessionContext;