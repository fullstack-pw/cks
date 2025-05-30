// frontend/components/ErrorBoundary.js

import React from 'react';
import { ErrorState, Button } from './common';
import ErrorHandler from '../utils/errorHandler';
import { useError } from '../hooks/useError';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
            errorId: null
        };
    }

    static getDerivedStateFromError(error) {
        // Update state so the next render will show the fallback UI
        return {
            hasError: true,
            error
        };
    }

    componentDidCatch(error, errorInfo) {
        // Generate a unique error ID for reference
        const errorId = `err_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 5)}`;

        // Process and log the error
        const processedError = ErrorHandler.processApiError(error, `component:${this.props.componentName || 'unknown'}`);
        ErrorHandler.logError({
            ...processedError,
            componentStack: errorInfo.componentStack,
            errorId
        });

        // You could also send to an error reporting service here

        this.setState({
            errorInfo,
            errorId
        });
    }

    render() {
        const { fallback, resetCondition } = this.props;

        // If a reset condition changes, clear the error state
        // This is useful when key props change that would fix the error
        if (resetCondition !== undefined &&
            this.state.hasError &&
            this.resetCondition !== resetCondition) {
            this.resetCondition = resetCondition;
            this.setState({ hasError: false, error: null, errorInfo: null });
        }

        if (this.state.hasError) {
            // Custom fallback UI
            if (fallback) {
                return fallback(this.state.error, this.resetErrorBoundary);
            }

            // Default fallback UI
            return (
                <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
                    <div className="max-w-md w-full space-y-8">
                        <ErrorState
                            message="Something went wrong"
                            details={
                                <>
                                    <p className="text-sm text-gray-600 mt-2">
                                        We're sorry, but there was an error in the application.
                                        {this.state.errorId && (
                                            <span className="block mt-1">
                                                Error reference: <code className="bg-gray-100 px-1 py-0.5 rounded">{this.state.errorId}</code>
                                            </span>
                                        )}
                                    </p>
                                    {process.env.NODE_ENV !== 'production' && this.state.error && (
                                        <div className="mt-4 p-3 bg-red-50 rounded text-xs overflow-auto max-h-64">
                                            <p className="font-mono text-red-800">
                                                {this.state.error.toString()}
                                            </p>
                                            {this.state.errorInfo && (
                                                <details className="mt-2">
                                                    <summary className="cursor-pointer text-gray-700">Component Stack</summary>
                                                    <pre className="mt-2 text-red-600 whitespace-pre-wrap">
                                                        {this.state.errorInfo.componentStack}
                                                    </pre>
                                                </details>
                                            )}
                                        </div>
                                    )}
                                </>
                            }
                            onRetry={this.resetErrorBoundary}
                        />
                        <div className="mt-4 flex justify-center space-x-4">
                            <Button
                                variant="primary"
                                onClick={() => window.location.reload()}
                            >
                                Reload Page
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => window.location.href = '/'}
                            >
                                Go to Home
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }

    resetErrorBoundary = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };
}

// Create a hook for functional components to throw errors safely
export const useErrorHandler = (givenError, context = 'component') => {
    const { handleError } = useError(context, { showToast: false });
    const [error, setError] = React.useState(null);

    if (givenError && !error) {
        setError(givenError);
    }

    if (error) {
        const processedError = handleError(error);
        throw processedError;
    }
};

export default ErrorBoundary;