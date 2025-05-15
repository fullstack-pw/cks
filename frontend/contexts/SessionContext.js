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

    // Validate a task with proper cancellation and race condition handling
    const validateTask = useCallback(async (sessionId, taskId) => {
        const requestKey = `validate-${sessionId}-${taskId}`;

        // Cancel any existing validation for this task
        cancelActiveRequest(requestKey);

        // Create new abort controller
        const controller = new AbortController();
        activeRequests.current.set(requestKey, controller);

        try {
            setLoading(true);
            setError(null);

            // Optimistic update: mark task as validating
            mutate(`/sessions/${sessionId}`, (current) => {
                if (!current || !current.tasks) return current;

                return {
                    ...current,
                    tasks: current.tasks.map(task =>
                        task.id === taskId
                            ? { ...task, status: 'validating' }
                            : task
                    )
                };
            }, false);

            // Perform validation with abort signal
            const result = await api.tasks.validateWithSignal(sessionId, taskId, {
                signal: controller.signal
            });

            // Update cache with validation result
            mutate(`/sessions/${sessionId}`, (current) => {
                if (!current || !current.tasks) return current;

                return {
                    ...current,
                    tasks: current.tasks.map(task =>
                        task.id === taskId
                            ? { ...task, status: result.success ? 'completed' : 'failed' }
                            : task
                    )
                };
            }, false);

            // Show success toast only for successful validations
            if (result.success) {
                toast.success('Task validated successfully');
            }

            return result;
        } catch (err) {
            // Check if request was cancelled
            if (err.name === 'AbortError') {
                console.log('Validation cancelled');
                return {
                    success: false,
                    message: 'Validation cancelled',
                    details: []
                };
            }

            // Revert optimistic update on error
            mutate(`/sessions/${sessionId}`, (current) => {
                if (!current || !current.tasks) return current;

                return {
                    ...current,
                    tasks: current.tasks.map(task =>
                        task.id === taskId
                            ? { ...task, status: 'pending' } // Revert to previous state
                            : task
                    )
                };
            }, false);

            const processedError = ErrorHandler.handleError(
                err,
                'task:validate',
                null
            );

            toast.error(processedError.message);

            return {
                success: false,
                message: processedError.message,
                details: processedError.details || []
            };
        } finally {
            setLoading(false);
            activeRequests.current.delete(requestKey);
        }
    }, [toast, cancelActiveRequest]);

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
            toast.success('Lab session created successfully');
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

    // Create a terminal session with enhanced error handling
    const createTerminal = async (sessionId, target) => {
        try {
            const result = await api.terminals.create(sessionId, target);
            toast.success(`Terminal created for ${target}`);
            return result;
        } catch (err) {
            // Use our error handler to process the error
            const processedError = ErrorHandler.handleError(
                err,
                'terminal:create',
                toast.error
            );

            setError(processedError);
            throw processedError;
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
        validateTask,
        createTerminal,
        clearError,
        fetcher
    }), [loading, error, createSession, deleteSession, extendSession, validateTask, createTerminal, clearError, fetcher]);

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