// frontend/components/common/ErrorState.js
import React from 'react';
import Button from './Button';

/**
 * Reusable error state component
 * @param {Object} props
 * @param {string} props.message - Error message
 * @param {string} props.details - Optional error details
 * @param {Function} props.onRetry - Optional retry handler
 */
const ErrorState = ({ message = 'Something went wrong', details, onRetry }) => {
  return (
    <div className="bg-red-50 border border-red-100 rounded-md p-4 my-4">
      <div className="flex">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="ml-3">
          <h3 className="text-sm font-medium text-red-800">{message}</h3>
          {details && <div className="mt-2 text-sm text-red-700">{details}</div>}
          {onRetry && (
            <div className="mt-4">
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Try again
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ErrorState;