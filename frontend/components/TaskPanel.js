// frontend/components/TaskPanel.js
import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSession } from '../hooks/useSession';
import { Button, Card, ErrorState, LoadingState, StatusIndicator } from './common';

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
                    throw new Error(`Failed to fetch scenario: ${response.status}`);
                }
                const data = await response.json();
                setScenario(data);
                setError(null);
            } catch (err) {
                setError(err.message || 'Failed to load scenario details');
                console.error('Error fetching scenario:', err);
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
                message: err.message || 'Validation failed due to an unexpected error'
            });
            console.error('Task validation error:', err);
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
        return <LoadingState message="Loading scenario details..." />;
    }

    if (error) {
        return (
            <ErrorState
                message="Failed to load scenario"
                details={error}
                onRetry={() => window.location.reload()}
            />
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
                                    }`}
                            >
                                <div className="flex items-center">
                                    <StatusIndicator
                                        status={status}
                                        size="sm"
                                    />
                                    <span className="ml-2">Task {index + 1}</span>
                                </div>
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
                        <StatusIndicator
                            status={getTaskStatus(currentTask.id)}
                            label={getTaskStatus(currentTask.id) === 'completed' ? 'Completed' :
                                getTaskStatus(currentTask.id) === 'failed' ? 'Failed' : 'Pending'}
                        />
                    </div>

                    <Card className="mb-6">
                        <div className="prose prose-indigo max-w-none">
                            <ReactMarkdown>{currentTask.description}</ReactMarkdown>
                        </div>
                    </Card>

                    {/* Hints */}
                    {currentTask.hints && currentTask.hints.length > 0 && (
                        <div className="mb-6">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleHint(currentTask.id)}
                            >
                                {showHints[currentTask.id] ? 'Hide Hints' : 'Show Hints'}
                            </Button>

                            {showHints[currentTask.id] && (
                                <Card className="mt-2 bg-indigo-50">
                                    <h3 className="text-sm font-medium text-indigo-800 mb-2">Hints</h3>
                                    <ul className="list-disc pl-5 space-y-1">
                                        {currentTask.hints.map((hint, index) => (
                                            <li key={index} className="text-sm text-indigo-700">
                                                {hint}
                                            </li>
                                        ))}
                                    </ul>
                                </Card>
                            )}
                        </div>
                    )}

                    {/* Validation results */}
                    {validationResult && (
                        <Card
                            className={`mb-6 ${validationResult.success ? 'bg-green-50' : 'bg-red-50'}`}
                        >
                            <h3 className={`text-sm font-medium mb-2 ${validationResult.success ? 'text-green-800' : 'text-red-800'}`}>
                                {validationResult.success ? 'Task Completed!' : 'Validation Failed'}
                            </h3>
                            <p className={`text-sm ${validationResult.success ? 'text-green-700' : 'text-red-700'}`}>
                                {validationResult.message}
                            </p>

                            {validationResult.details && validationResult.details.length > 0 && (
                                <div className="mt-2 border-t border-gray-200 pt-2">
                                    <h4 className="text-xs font-medium text-gray-500 mb-1">Details</h4>
                                    <ul className="space-y-1">
                                        {validationResult.details.map((detail, index) => (
                                            <li key={index} className={`text-sm flex items-start ${detail.passed ? 'text-green-700' : 'text-red-700'}`}>
                                                <StatusIndicator
                                                    status={detail.passed ? 'completed' : 'failed'}
                                                    size="sm"
                                                />
                                                <span className="ml-2">{detail.message}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </Card>
                    )}

                    {/* Validation button */}
                    <div className="pt-4">
                        <Button
                            variant="primary"
                            onClick={() => handleValidateTask(currentTask.id)}
                            isLoading={validating}
                            disabled={validating}
                        >
                            Validate Task
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TaskPanel;