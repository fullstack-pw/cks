import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { mutate } from 'swr';
import { useToast } from './ToastContext';
import api from '../lib/api';
import ErrorHandler from '../utils/errorHandler';

// Create context
const SessionContext = createContext(null);

// Context provider component
export const SessionProvider = ({ children }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const router = useRouter();
    const toast = useToast();

    // Track active requests for cancellation
    const activeRequests = useRef(new Map());

    // Cancel active request helper
    const cancelActiveRequest = useCallback((key) => {
        const controller = activeRequests.current.get(key);
        if (controller) {
            controller.abort();
            activeRequests.current.delete(key);
        }
    }, []);

    // Global fetcher function for SWR with error handling
    const fetcher = async (url) => {
        try {
            return await api.sessions.get(url.split('/').pop());
        } catch (err) {
            const processedError = ErrorHandler.handleError(
                err,
                'session:fetch',
                toast.error
            );
            setError(processedError);
            throw processedError;
        }
    };

    // NOTE: Removed validateTask - now handled by TaskValidation component
    // This simplifies the context and removes duplicate validation logic

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Cancel all active requests
            activeRequests.current.forEach((controller) => {
                controller.abort();
            });
            activeRequests.current.clear();
        };
    }, []);

    // Create a new session with enhanced error handling
    const createSession = async (scenarioId) => {
        setLoading(true);
        setError(null);

        try {
            const result = await api.sessions.create(scenarioId);
            // Prefetch the session data for SWR
            mutate(`/sessions/${result.sessionId}`, result, false);
            toast.success('Lab session created and ready!');
            router.push(`/lab/${result.sessionId}`);
            return result;
        } catch (err) {
            // Use our error handler to process the error
            const processedError = ErrorHandler.handleError(
                err,
                'session:create',
                toast.error
            );

            setError(processedError);
            throw processedError;
        } finally {
            setLoading(false);
        }
    };

    // Delete a session with enhanced error handling
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
            // Use our error handler to process the error
            const processedError = ErrorHandler.handleError(
                err,
                'session:delete',
                toast.error
            );

            setError(processedError);
            throw processedError;
        } finally {
            setLoading(false);
        }
    };

    // Extend a session with enhanced error handling
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
            // Use our error handler to process the error
            const processedError = ErrorHandler.handleError(
                err,
                'session:extend',
                toast.error
            );

            setError(processedError);
            throw processedError;
        } finally {
            setLoading(false);
        }
    };

    // Add a function to clear errors
    const clearError = () => {
        setError(null);
    };

    const value = useMemo(() => ({
        loading,
        error,
        createSession,
        deleteSession,
        extendSession,
        clearError,
        fetcher
        // Removed validateTask - now handled by dedicated components
    }), [loading, error, createSession, deleteSession, extendSession, clearError, fetcher]);

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