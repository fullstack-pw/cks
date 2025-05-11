// frontend/hooks/useErrorBoundary.js

import { useState, useCallback } from 'react';
import ErrorHandler from '../utils/errorHandler';
import { useToast } from '../contexts/ToastContext';

/**
 * Hook to handle errors in functional components
 * @param {string} context - Error context name for logging and tracking
 * @param {Object} options - Hook options
 * @returns {Object} Error handling helpers
 */
export function useErrorBoundary(context = 'component', options = {}) {
  const [error, setError] = useState(null);
  const [isHandlingError, setIsHandlingError] = useState(false);
  const toast = useToast();

  const { showToast = true, captureErrors = true } = options;

  // Function to handle errors with proper error processing
  const handleError = useCallback((err, actionContext = '') => {
    // Skip if we're already handling an error
    if (isHandlingError) return;

    setIsHandlingError(true);

    // Process the error with the ErrorHandler
    const fullContext = actionContext ? `${context}:${actionContext}` : context;
    const processedError = ErrorHandler.processApiError(err, fullContext);

    // Log the error
    ErrorHandler.logError(processedError);

    // Show toast notification if enabled
    if (showToast && toast) {
      toast.error(ErrorHandler.getUserMessage(processedError));
    }

    // Set the error state
    setError(processedError);

    // If we're capturing errors, throw the error for error boundaries
    if (captureErrors) {
      throw processedError;
    }

    setIsHandlingError(false);
    return processedError;
  }, [context, isHandlingError, showToast, toast, captureErrors]);

  // Reset the error state
  const resetError = useCallback(() => {
    setError(null);
    setIsHandlingError(false);
  }, []);

  // Wrap an async function with error handling
  const withErrorHandling = useCallback((fn, actionContext = '') => {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        return handleError(err, actionContext);
      }
    };
  }, [handleError]);

  return {
    error,
    handleError,
    resetError,
    withErrorHandling,
    isError: !!error
  };
}

export default useErrorBoundary;