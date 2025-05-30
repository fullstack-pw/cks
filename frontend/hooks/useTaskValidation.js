// frontend/hooks/useTaskValidation.js
import { useState, useCallback, useRef } from 'react';

export function useTaskValidation(sessionId, taskId) {
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [error, setError] = useState(null);
  const [lastValidated, setLastValidated] = useState(null);

  // Track active request for cancellation
  const activeRequest = useRef(null);

  const validateTask = useCallback(async () => {
    if (isValidating || !sessionId || !taskId) return null;

    // Cancel any existing request
    if (activeRequest.current) {
      activeRequest.current.abort();
    }

    const controller = new AbortController();
    activeRequest.current = controller;

    try {
      setIsValidating(true);
      setError(null);

      console.log(`[TaskValidation] Starting validation for task ${taskId} in session ${sessionId}`);

      const response = await fetch(`/api/v1/sessions/${sessionId}/tasks/${taskId}/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Validation failed: ${response.status}`);
      }

      const result = await response.json();

      console.log(`[TaskValidation] Validation completed:`, result);

      setValidationResult(result);
      setLastValidated(new Date());

      return result;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log(`[TaskValidation] Validation cancelled for task ${taskId}`);
        return null;
      }

      console.error(`[TaskValidation] Validation failed:`, err);
      setError(err.message);
      return null;
    } finally {
      setIsValidating(false);
      activeRequest.current = null;
    }
  }, [sessionId, taskId, isValidating]);

  const clearValidation = useCallback(() => {
    setValidationResult(null);
    setError(null);
    setLastValidated(null);
  }, []);

  const retryValidation = useCallback(() => {
    setError(null);
    return validateTask();
  }, [validateTask]);

  // Cleanup function to cancel active requests
  const cleanup = useCallback(() => {
    if (activeRequest.current) {
      activeRequest.current.abort();
      activeRequest.current = null;
    }
  }, []);

  // Get validation summary
  const getValidationSummary = useCallback(() => {
    if (!validationResult?.results) return null;

    const passed = validationResult.results.filter(r => r.passed).length;
    const total = validationResult.results.length;

    return {
      passed,
      total,
      success: passed === total,
      percentage: total > 0 ? Math.round((passed / total) * 100) : 0
    };
  }, [validationResult]);

  return {
    // State
    isValidating,
    validationResult,
    error,
    lastValidated,

    // Actions
    validateTask,
    clearValidation,
    retryValidation,
    cleanup,

    // Computed
    summary: getValidationSummary(),
    hasResults: !!validationResult,
    hasError: !!error,
  };
}

export default useTaskValidation;