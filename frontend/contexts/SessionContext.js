// frontend/contexts/SessionContext.js (enhanced error handling)

import React, { createContext, useContext, useState, useEffect } from 'react';
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

    // Global fetcher function for SWR with error handling
    const fetcher = async (url) => {
        try {
            return await api.sessions.get(url.split('/').pop());
        } catch (err) {
            // Use our error handler to process the error
            const processedError = ErrorHandler.handleError(
                err,
                'session:fetch',
                toast.error
            );

            setError(processedError);
            throw processedError;
        }
    };

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

    // Validate a task with enhanced error handling
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
                toast.warning(result.message || 'Task validation failed');
            }

            return result; // Always return the result, don't throw

        } catch (err) {
            const processedError = ErrorHandler.handleError(
                err,
                'task:validate',
                null // Don't show double toast
            );

            // Show toast notification
            toast.error(processedError.message);

            // Return error as result instead of throwing
            return {
                success: false,
                message: processedError.message,
                details: processedError.details || []
            };

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
        clearError,

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