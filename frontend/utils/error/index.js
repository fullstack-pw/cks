// frontend/utils/error/index.js
import ErrorHandler from '../errorHandler';
import { useError } from '../../hooks/useError';
import ErrorBoundary, { useErrorHandler } from '../../components/ErrorBoundary';

export {
  ErrorHandler,
  useError,
  ErrorBoundary,
  useErrorHandler
};

export default ErrorHandler;