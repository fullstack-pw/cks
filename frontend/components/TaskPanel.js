// frontend/components/TaskPanel.js
import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSession } from '../hooks/useSession';
import { Button, Card, ErrorState, LoadingState, StatusIndicator } from './common';
import ValidationProgress from './ValidationProgress';

const TaskPanel = ({ sessionId, scenarioId }) => {
    const { session, validateTask } = useSession(sessionId);
    const [scenario, setScenario] = useState(null);
    const [activeTaskIndex, setActiveTaskIndex] = useState(0);
    const [showHints, setShowHints] = useState({});
    const [validating, setValidating] = useState(false);
    const [validationResult, setValidationResult] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showAllTasks, setShowAllTasks] = useState(false);
    const [validationProgress, setValidationProgress] = useState(null);
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

        // Set up validation stages for progress tracking
        const validationStages = [
            { name: 'Connecting to cluster', message: 'Establishing connection...' },
            { name: 'Checking resources', message: 'Verifying Kubernetes resources...' },
            { name: 'Validating configuration', message: 'Checking task requirements...' },
            { name: 'Final verification', message: 'Completing validation...' }
        ];

        setValidationProgress({
            stages: validationStages,
            currentStage: 0
        });

        try {
            // Simulate progress through stages (in real app, this would be from WebSocket)
            const progressInterval = setInterval(() => {
                setValidationProgress(prev => {
                    if (!prev || prev.currentStage >= prev.stages.length - 1) {
                        return prev;
                    }
                    return {
                        ...prev,
                        currentStage: prev.currentStage + 1
                    };
                });
            }, 1000);

            const result = await validateTask(sessionId, taskId);

            clearInterval(progressInterval);
            setValidationProgress(null);
            setValidationResult(result);

            // Don't throw errors here - handle them gracefully
            return result;
        } catch (err) {
            // Handle error locally instead of re-throwing
            setValidationProgress(null);
            setValidationResult({
                success: false,
                message: err.message || 'Validation failed due to an unexpected error',
                details: []
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
            {/* Mobile toggle for task list */}
            <div className="lg:hidden border-b border-gray-200 p-2">
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowAllTasks(!showAllTasks)}
                    className="w-full"
                >
                    {showAllTasks ? 'Hide Task List' : 'Show All Tasks'}
                </Button>
            </div>

            {/* Task navigation tabs */}
            <div className={`border-b border-gray-200 overflow-x-auto ${showAllTasks ? 'block' : 'hidden lg:block'}`}>
                <div className="flex">
                    {tasks.map((task, index) => {
                        const status = getTaskStatus(task.id);
                        return (
                            <button
                                key={task.id}
                                onClick={() => {
                                    setActiveTaskIndex(index);
                                    setShowAllTasks(false);
                                }}
                                className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${activeTaskIndex === index
                                    ? 'border-indigo-500 text-indigo-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                            >
                                <div className="flex items-center">
                                    <StatusIndicator
                                        status={status}
                                        size="sm"
                                    />
                                    <span className="ml-1 text-xs sm:text-sm">Task {index + 1}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Task content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-3 sm:p-6">
                    <div className="flex justify-between items-start mb-4">
                        <h2 className="text-lg sm:text-xl font-medium text-gray-900 truncate">{currentTask.title}</h2>
                        <StatusIndicator
                            status={getTaskStatus(currentTask.id)}
                            label={getTaskStatus(currentTask.id) === 'completed' ? 'Completed' :
                                getTaskStatus(currentTask.id) === 'failed' ? 'Failed' : 'Pending'}
                        />
                    </div>

                    <Card className="mb-6">
                        <div className="prose prose-sm sm:prose-base prose-indigo max-w-none">
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
                                            <li key={index} className="text-xs sm:text-sm text-indigo-700">
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
                            <div className="p-4">
                                <h3 className={`text-sm font-medium mb-2 ${validationResult.success ? 'text-green-800' : 'text-red-800'
                                    }`}>
                                    {validationResult.success ? '✓ Task Completed!' : '✗ Validation Failed'}
                                </h3>
                                <p className={`text-sm ${validationResult.success ? 'text-green-700' : 'text-red-700'
                                    }`}>
                                    {validationResult.message}
                                </p>

                                {validationResult.details && validationResult.details.length > 0 && (
                                    <div className="mt-3 border-t pt-3">
                                        <h4 className="text-xs font-medium text-gray-700 mb-2">Details:</h4>
                                        <ul className="space-y-1">
                                            {validationResult.details.map((detail, index) => (
                                                <li key={index} className={`text-xs flex items-start ${detail.passed ? 'text-green-700' : 'text-red-700'
                                                    }`}>
                                                    <span className="mr-2">{detail.passed ? '✓' : '✗'}</span>
                                                    <span>{detail.message}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </Card>
                    )}

                    {/* Validation button */}
                    <div className="pt-4">
                        <Button
                            variant="primary"
                            onClick={() => handleValidateTask(currentTask.id)}
                            isLoading={validating}
                            disabled={validating || getTaskStatus(currentTask.id) === 'completed'}
                            className="w-full sm:w-auto"
                        >
                            {validating ? 'Validating...' : 'Validate Task'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TaskPanel;