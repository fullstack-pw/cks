// frontend/utils/errorHandler.js

/**
 * A unified error handling utility for the application
 */
export class ErrorHandler {
  /**
   * Processes API errors into a standardized format
   * @param {Error} error - The error object
   * @param {string} context - Where the error occurred
   * @returns {Object} Standardized error object
   */
  static processApiError(error, context = 'api') {
    // Handle null/undefined errors
    if (!error) {
      console.warn(`processApiError called with null/undefined error in ${context}`);
      return {
        message: 'An unexpected error occurred',
        context,
        timestamp: new Date().toISOString(),
        status: 500,
        isTimeout: false,
        details: null,
        originalError: null,
      };
    }

    console.error(`Error in ${context}:`, error);

    // Default error structure
    const processedError = {
      message: 'An unexpected error occurred',
      context,
      timestamp: new Date().toISOString(),
      status: error.status || 500,
      isTimeout: error.isTimeout || false,
      details: null,
      originalError: error,
    };

    // Handle different error types
    if (error.info) {
      // API returned structured error
      processedError.message = error.info.message || error.message || processedError.message;
      processedError.details = error.info.details || error.info;
    } else if (error.message) {
      processedError.message = error.message;
    }

    // Handle timeout errors specifically
    if (error.isTimeout) {
      processedError.message = 'Request timed out. Please try again.';
    }

    // Handle specific HTTP status codes
    if (error.status) {
      switch (error.status) {
        case 401:
          processedError.message = 'Authentication required. Please log in again.';
          break;
        case 403:
          processedError.message = 'You do not have permission to perform this action.';
          break;
        case 404:
          processedError.message = 'The requested resource was not found.';
          break;
        case 408:
          processedError.message = 'Request timed out. Please try again.';
          break;
        case 429:
          processedError.message = 'Too many requests. Please try again later.';
          break;
        case 500:
          processedError.message = 'Server error. Please try again later.';
          break;
      }
    }

    return processedError;
  }

  /**
   * Logs error to the console and any external services
   * @param {Object} error - The processed error object
   */
  static logError(error) {
    console.error(`[${error.context}] ${error.message}`, error);

    // Here you could add external logging services like Sentry
    // if (typeof window !== 'undefined' && window.Sentry) {
    //   window.Sentry.captureException(error.originalError || error);
    // }
  }

  /**
   * User-friendly error message generator
   * @param {Object} error - The processed error object
   * @returns {string} User-friendly error message
   */
  static getUserMessage(error) {
    // For some errors, we want to show technical details
    // For others, we want to show a friendly message
    if (error.status >= 500) {
      return "We're experiencing technical difficulties. Please try again later.";
    }

    if (error.isTimeout) {
      return "The request is taking longer than expected. Please check your connection and try again.";
    }

    // Return the processed message by default
    return error.message;
  }

  /**
   * Determines if an error should trigger a global notification
   * @param {Object} error - The processed error object
   * @returns {boolean} Whether to show a global notification
   */
  static shouldShowGlobalNotification(error) {
    // Decide which errors warrant a global notification
    // Some errors might be handled locally in components

    // Don't show global notifications for form validation errors
    if (error.status === 400 && error.details?.validationErrors) {
      return false;
    }

    // Authentication errors should be handled by redirecting to login
    if (error.status === 401) {
      return false;
    }

    return true;
  }

  /**
   * Complete error handling flow
   * @param {Error} error - The original error
   * @param {string} context - Error context
   * @param {Function} notifyFn - Toast notification function (optional)
   * @returns {Object} Processed error for component use
   */
  static handleError(error, context, notifyFn = null) {
    const processedError = this.processApiError(error, context);
    this.logError(processedError);

    if (notifyFn && this.shouldShowGlobalNotification(processedError)) {
      notifyFn(this.getUserMessage(processedError), 'error');
    }

    return processedError;
  }
}

export default ErrorHandler;