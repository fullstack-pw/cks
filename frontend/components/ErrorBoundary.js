// frontend/components/ErrorBoundary.js - Error boundary component

import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        // Update state so the next render will show the fallback UI
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        // You can also log the error to an error reporting service
        this.setState({ errorInfo });
        console.error('Error caught by boundary:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            // Custom fallback UI
            return (
                <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
                    <div className="max-w-md w-full space-y-8">
                        <div>
                            <h1 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
                                Something went wrong
                            </h1>
                            <p className="mt-2 text-center text-sm text-gray-600">
                                We're sorry, but there was an error in the application.
                            </p>
                        </div>
                        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
                            <div className="px-4 py-5 sm:px-6">
                                <h3 className="text-lg leading-6 font-medium text-gray-900">
                                    Error details
                                </h3>
                            </div>
                            <div className="border-t border-gray-200">
                                <div className="px-4 py-5 sm:p-6">
                                    <div className="bg-red-50 p-4 rounded-md">
                                        <p className="text-sm text-red-700">
                                            {this.state.error && this.state.error.toString()}
                                        </p>
                                    </div>
                                    <div className="mt-4">
                                        <button
                                            type="button"
                                            onClick={() => window.location.reload()}
                                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                                        >
                                            Reload page
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => window.location.href = '/'}
                                            className="ml-3 inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                                        >
                                            Return to home
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;