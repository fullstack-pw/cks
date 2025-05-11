// frontend/components/common/ErrorState.js (enhanced version)

import React from 'react';
import Button from './Button';

/**
 * Enhanced error state component with better visualization and recovery options
 * @param {Object} props
 * @param {string} props.message - Error message
 * @param {React.ReactNode} props.details - Optional error details
 * @param {Function} props.onRetry - Optional retry handler
 * @param {string} props.level - Error severity level ('error', 'warning', 'info')
 * @param {Function} props.onDismiss - Optional dismiss handler
 * @param {boolean} props.dismissable - Whether the error can be dismissed
 * @param {string} props.className - Additional CSS classes
 */
const ErrorState = ({
  message = 'Something went wrong',
  details,
  onRetry,
  level = 'error',
  onDismiss,
  dismissable = false,
  className = '',
}) => {
  // Determine styling based on level
  const levelStyles = {
    error: {
      bg: 'bg-red-50',
      border: 'border-red-100',
      text: 'text-red-800',
      detailsText: 'text-red-700',
      icon: 'text-red-400',
    },
    warning: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-100',
      text: 'text-yellow-800',
      detailsText: 'text-yellow-700',
      icon: 'text-yellow-400',
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-100',
      text: 'text-blue-800',
      detailsText: 'text-blue-700',
      icon: 'text-blue-400',
    },
  };

  const styles = levelStyles[level] || levelStyles.error;

  // Determine icon based on level
  const renderIcon = () => {
    switch (level) {
      case 'warning':
        return (
          <svg className={`h-5 w-5 ${styles.icon}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'info':
        return (
          <svg className={`h-5 w-5 ${styles.icon}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        );
      default: // error
        return (
          <svg className={`h-5 w-5 ${styles.icon}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        );
    }
  };

  return (
    <div className={`${styles.bg} ${styles.border} rounded-md p-4 my-4 ${className}`}>
      <div className="flex">
        <div className="flex-shrink-0">
          {renderIcon()}
        </div>
        <div className="ml-3 flex-1">
          <h3 className={`text-sm font-medium ${styles.text}`}>{message}</h3>
          {details && (
            typeof details === 'string' ? (
              <div className={`mt-2 text-sm ${styles.detailsText}`}>{details}</div>
            ) : (
              <div className={`mt-2 text-sm ${styles.detailsText}`}>{details}</div>
            )
          )}
          {(onRetry || onDismiss) && (
            <div className="mt-4 flex">
              {onRetry && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onRetry}
                  className="mr-2"
                >
                  Try again
                </Button>
              )}
              {onDismiss && dismissable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDismiss}
                >
                  Dismiss
                </Button>
              )}
            </div>
          )}
        </div>
        {dismissable && onDismiss && (
          <div className="ml-auto pl-3">
            <div className="-mx-1.5 -my-1.5">
              <button
                type="button"
                className={`inline-flex rounded-md p-1.5 ${styles.bg} ${styles.text} hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
                onClick={onDismiss}
              >
                <span className="sr-only">Dismiss</span>
                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ErrorState;