// frontend/components/TaskPanel.js - Updated to use new hook

import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSession } from '../hooks/useSession';

const TaskPanel = ({ sessionId, scenarioId }) => {
    const { session, validateTask } = useSession(sessionId);
    const [scenario, setScenario] = useState(null);
    const [activeTaskIndex, setActiveTaskIndex] = useState(0);
    const [showHints, setShowHints] = useState({});
    const [validating, setValidating] = useState(false);
    const [validationResult, setValidationResult] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Fetch scenario data
    useEffect(() => {
        const fetchScenario = async () => {
            if (!scenarioId) return;

            try {
                setLoading(true);
                const response = await fetch(`/api/v1/scenarios/${scenarioId}`);
                if (!response.ok) {
                    throw new Error('Failed to fetch scenario');
                }
                const data = await response.json();
                setScenario(data);
                setError(null);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchScenario();
    }, [scenarioId]);

    // Handle task validation
    const handleValidateTask = async (taskId) => {
        setValidating(true);
        setValidationResult(null);

        try {
            const result = await validateTask(sessionId, taskId);
            setValidationResult(result);
            return result;
        } catch (err) {
            setValidationResult({
                success: false,
                message: err.message || 'Validation failed'
            });
        } finally {
            setValidating(false);
        }
    };

    // Toggle hint visibility
    const toggleHint = (taskId) => {
        setShowHints(prev => ({
            ...prev,
            [taskId]: !prev[taskId]
        }));
    };

    // Get task status
    const getTaskStatus = (taskId) => {
        if (!session || !session.tasks) return 'pending';

        const task = session.tasks.find(t => t.id === taskId);
        return task ? task.status : 'pending';
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4">
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-md">
                    <p>{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-2 text-sm text-red-600 underline"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!scenario || !session) {
        return (
            <div className="p-4">
                <p className="text-gray-500">No scenario or session data available.</p>
            </div>
        );
    }

    const tasks = scenario.tasks || [];

    if (tasks.length === 0) {
        return (
            <div className="p-4">
                <p className="text-gray-500">No tasks available for this scenario.</p>
            </div>
        );
    }

    const currentTask = tasks[activeTaskIndex];

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Task navigation tabs */}
            <div className="border-b border-gray-200 overflow-x-auto">
                <div className="flex">
                    {tasks.map((task, index) => {
                        const status = getTaskStatus(task.id);
                        return (
                            <button
                                key={task.id}
                                onClick={() => setActiveTaskIndex(index)}
                                className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap ${activeTaskIndex === index
                                    ? 'border-indigo-500 text-indigo-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    } ${status === 'completed' ? 'text-green-600' :
                                        status === 'failed' ? 'text-red-600' : ''
                                    }`}
                            >
                                {status === 'completed' && (
                                    <svg className="inline-block h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                )}
                                {status === 'failed' && (
                                    <svg className="inline-block h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                )}
                                Task {index + 1}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Task content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-6">
                    <div className="flex justify-between items-start mb-4">
                        <h2 className="text-xl font-medium text-gray-900">{currentTask.title}</h2>
                        {getTaskStatus(currentTask.id) === 'completed' && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                Completed
                            </span>
                        )}
                        {getTaskStatus(currentTask.id) === 'failed' && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                Failed
                            </span>
                        )}
                    </div>

                    <div className="prose prose-indigo max-w-none mb-6">
                        <ReactMarkdown>{currentTask.description}</ReactMarkdown>
                    </div>

                    {/* Hints */}
                    {currentTask.hints && currentTask.hints.length > 0 && (
                        <div className="mb-6">
                            <button
                                onClick={() => toggleHint(currentTask.id)}
                                className="text-sm text-indigo-600 hover:text-indigo-800 focus:outline-none focus:underline"
                            >
                                {showHints[currentTask.id] ? 'Hide Hints' : 'Show Hints'}
                            </button>

                            {showHints[currentTask.id] && (
                                <div className="mt-2 bg-indigo-50 p-4 rounded-md">
                                    <h3 className="text-sm font-medium text-indigo-800 mb-2">Hints</h3>
                                    <ul className="list-disc pl-5 space-y-1">
                                        {currentTask.hints.map((hint, index) => (
                                            <li key={index} className="text-sm text-indigo-700">
                                                {hint}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Validation results */}
                    {validationResult && (
                        <div className={`mb-6 p-4 rounded-md ${validationResult.success
                            ? 'bg-green-50 border border-green-200'
                            : 'bg-red-50 border border-red-200'
                            }`}>
                            <h3 className={`text-sm font-medium mb-2 ${validationResult.success ? 'text-green-800' : 'text-red-800'
                                }`}>
                                {validationResult.success ? 'Task Completed!' : 'Validation Failed'}
                            </h3>
                            <p className={`text-sm ${validationResult.success ? 'text-green-700' : 'text-red-700'
                                }`}>
                                {validationResult.message}
                            </p>

                            {validationResult.details && validationResult.details.length > 0 && (
                                <div className="mt-2 border-t border-gray-200 pt-2">
                                    <h4 className="text-xs font-medium text-gray-500 mb-1">Details</h4>
                                    <ul className="space-y-1">
                                        {validationResult.details.map((detail, index) => (
                                            <li key={index} className={`text-sm flex items-start ${detail.passed ? 'text-green-700' : 'text-red-700'
                                                }`}>
                                                <span className="mr-1">{detail.passed ? '✓' : '✗'}</span>
                                                <span>{detail.message}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Validation button */}
                    <div className="pt-4">
                        <button
                            onClick={() => handleValidateTask(currentTask.id)}
                            disabled={validating}
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {validating ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Validating...
                                </>
                            ) : 'Validate Task'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TaskPanel;