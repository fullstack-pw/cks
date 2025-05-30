// frontend/components/TaskValidation.jsx
import React, { useEffect } from 'react';
import { Button, StatusIndicator } from './common';
import { useTaskValidation } from '../hooks/useTaskValidation';

const TaskValidation = ({
  taskId,
  sessionId,
  validationRules = [],
  onValidationComplete,
  className = ''
}) => {
  const {
    isValidating,
    validationResult,
    error,
    lastValidated,
    validateTask,
    retryValidation,
    cleanup,
    summary,
    hasResults,
    hasError
  } = useTaskValidation(sessionId, taskId);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Notify parent of validation completion
  useEffect(() => {
    if (validationResult && onValidationComplete) {
      onValidationComplete(validationResult);
    }
  }, [validationResult, onValidationComplete]);

  const handleValidate = async () => {
    await validateTask();
  };

  const handleRetry = async () => {
    await retryValidation();
  };

  return (
    <div className={`border rounded-lg ${className}`}>
      {/* Validation Header */}
      <div className="p-4 border-b bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h3 className="text-lg font-medium text-gray-900">Task Validation</h3>
            {lastValidated && (
              <span className="text-xs text-gray-500">
                Last validated: {lastValidated.toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            {summary && (
              <div className="flex items-center space-x-2">
                <StatusIndicator
                  status={summary.success ? 'completed' : 'failed'}
                  size="sm"
                />
                <span className="text-sm text-gray-600">
                  {summary.passed}/{summary.total} checks passed
                </span>
              </div>
            )}
            <Button
              variant="primary"
              onClick={handleValidate}
              disabled={isValidating}
              isLoading={isValidating}
            >
              {isValidating ? 'Validating...' : 'Validate Task'}
            </Button>
          </div>
        </div>
      </div>

      {/* Validation Content */}
      <div className="p-4">
        {/* Error State */}
        {hasError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <svg className="h-5 w-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-red-800">{error}</span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRetry}
                disabled={isValidating}
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isValidating && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mr-3"></div>
            <span className="text-gray-600">Running validation checks...</span>
          </div>
        )}

        {/* Results */}
        {hasResults && !isValidating && (
          <div className="space-y-4">
            {/* Overall Status */}
            <div className={`p-3 rounded-md ${validationResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <div className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${validationResult.success ? 'bg-green-500' : 'bg-red-500'}`}>
                  {validationResult.success ? (
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </div>
                <div>
                  <h4 className={`font-medium ${validationResult.success ? 'text-green-800' : 'text-red-800'}`}>
                    {validationResult.success ? 'All Checks Passed' : 'Validation Failed'}
                  </h4>
                  <p className={`text-sm ${validationResult.success ? 'text-green-700' : 'text-red-700'}`}>
                    {validationResult.message}
                  </p>
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            {summary && (
              <div className="bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${summary.success ? 'bg-green-500' : 'bg-red-500'}`}
                  style={{ width: `${summary.percentage}%` }}
                />
              </div>
            )}

            {/* Individual Results */}
            {validationResult.results && validationResult.results.length > 0 && (
              <div className="space-y-2">
                <h5 className="font-medium text-gray-900">Validation Details</h5>
                {validationResult.results.map((result, index) => (
                  <div key={`${result.ruleId}-${index}`} className={`p-3 rounded-md border ${result.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-start">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center mr-3 mt-0.5 ${result.passed ? 'bg-green-500' : 'bg-red-500'}`}>
                        {result.passed ? (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-medium ${result.passed ? 'text-green-800' : 'text-red-800'}`}>
                          {result.message}
                        </p>
                        {(result.expected !== undefined || result.actual !== undefined) && (
                          <div className="mt-2 text-xs space-y-1">
                            {result.expected !== undefined && (
                              <div className="text-gray-600">
                                <span className="font-medium">Expected:</span> {JSON.stringify(result.expected)}
                              </div>
                            )}
                            {result.actual !== undefined && (
                              <div className="text-gray-600">
                                <span className="font-medium">Actual:</span> {JSON.stringify(result.actual)}
                              </div>
                            )}
                          </div>
                        )}
                        {result.errorCode && (
                          <div className="mt-1 text-xs text-gray-500">
                            Error Code: {result.errorCode}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* No Results State */}
        {!hasResults && !isValidating && !hasError && (
          <div className="text-center py-8">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">Ready for Validation</h3>
            <p className="mt-1 text-sm text-gray-500">
              Click "Validate Task" to check your work
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskValidation;