// frontend/hooks/useError.js
import { useState, useCallback } from 'react';
import ErrorHandler from '../utils/errorHandler';
import { useToast } from '../contexts/ToastContext';

/**
 * Unified error handling hook that standardizes error processing across the app
 * @param {string} context - Error context for logging and tracking
 * @param {Object} options - Hook configuration options
 * @returns {Object} Error handling utilities
 */
export function useError(context = 'component', options = {}) {
  const [error, setError] = useState(null);
  const [isHandling, setIsHandling] = useState(false);
  const toast = useToast();

  const { showToast = true } = options;

  // Handle errors with standardized processing
  const handleError = useCallback((err, actionContext = '') => {
    if (isHandling) return null;

    // Don't process null/undefined errors
    if (!err) {
      console.warn(`handleError called with null/undefined error in ${context}:${actionContext}`);
      return null;
    }

    setIsHandling(true);

    const fullContext = actionContext ? `${context}:${actionContext}` : context;
    const processedError = ErrorHandler.processApiError(err, fullContext);

    ErrorHandler.logError(processedError);

    if (showToast && toast) {
      toast.error(ErrorHandler.getUserMessage(processedError));
    }

    setError(processedError);
    setIsHandling(false);

    return processedError;
  }, [context, isHandling, showToast, toast]);

  // Clear error state
  const clearError = useCallback(() => {
    setError(null);
    setIsHandling(false);
  }, []);

  // Wrap async functions with error handling
  const withErrorHandling = useCallback((fn, actionContext = '') => {
    return async (...args) => {
      try {
        clearError();
        return await fn(...args);
      } catch (err) {
        return handleError(err, actionContext);
      }
    };
  }, [handleError, clearError]);

  return {
    error,
    handleError,
    clearError,
    withErrorHandling,
    isError: !!error,
    isHandling
  };
}

export default useError;