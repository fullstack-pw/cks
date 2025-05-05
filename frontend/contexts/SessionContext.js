// frontend/contexts/SessionContext.js - Context provider for session state

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import api from '../lib/api';

// Create context
const SessionContext = createContext(null);

// Context provider component
export const SessionProvider = ({ children }) => {
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const router = useRouter();

    // Extract session ID from URL if on lab page
    useEffect(() => {
        const { pathname, query } = router;
        if (pathname.startsWith('/lab/') && query.id) {
            fetchSession(query.id);
        }
    }, [router.pathname, router.query]);

    // Create a new session
    const createSession = async (scenarioId) => {
        setLoading(true);
        setError(null);

        try {
            const result = await api.sessions.create(scenarioId);
            setSession(result);
            router.push(`/lab/${result.sessionId}`);
            return result;
        } catch (err) {
            setError(err);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Fetch session details
    const fetchSession = async (sessionId) => {
        if (!sessionId) return;

        setLoading(true);
        setError(null);

        try {
            const session = await api.sessions.get(sessionId);
            setSession(session);
            return session;
        } catch (err) {
            setError(err);

            // Redirect to home page if session not found
            if (err.status === 404) {
                router.push('/');
            }

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
            setSession(null);
            router.push('/');
        } catch (err) {
            setError(err);
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
            // Refresh session data
            return fetchSession(sessionId);
        } catch (err) {
            setError(err);
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
            // Refresh session data
            await fetchSession(sessionId);
            return result;
        } catch (err) {
            setError(err);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    // Create a terminal
    const createTerminal = async (sessionId, target) => {
        try {
            return await api.terminals.create(sessionId, target);
        } catch (err) {
            setError(err);
            throw err;
        }
    };

    // The context value
    const value = {
        session,
        loading,
        error,
        createSession,
        fetchSession,
        deleteSession,
        extendSession,
        validateTask,
        createTerminal,
    };

    return (
        <SessionContext.Provider value={value}>
            {children}
        </SessionContext.Provider>
    );
};

// Custom hook to use the session context
export const useSession = () => {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error('useSession must be used within a SessionProvider');
    }
    return context;
};

export default SessionContext;