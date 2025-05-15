// frontend/utils/error/index.js
import ErrorHandler from '../errorHandler';
import { useErrorBoundary } from '../../hooks/useErrorBoundary';
import ErrorBoundary, { useErrorHandler } from '../../components/ErrorBoundary';

export {
  ErrorHandler,
  useErrorBoundary,
  ErrorBoundary,
  useErrorHandler
};

export default ErrorHandler;