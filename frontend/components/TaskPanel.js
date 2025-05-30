// frontend/components/TaskPanel.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSession } from '../hooks/useSession';
import { Button, Card, ErrorState, LoadingState, StatusIndicator } from './common';
import ValidationDisplay from './ValidationDisplay';
import { useError } from '../hooks/useError';


const TaskPanel = ({ sessionId, scenarioId }) => {
    const { session, validateTask, isLoading: sessionLoading } = useSession(sessionId);
    const [scenario, setScenario] = useState(null);
    const [activeTaskIndex, setActiveTaskIndex] = useState(0);
    const [showHints, setShowHints] = useState({});
    const [loading, setLoading] = useState(true);
    const { error, handleError, clearError } = useError('task-panel');
    const [showAllTasks, setShowAllTasks] = useState(false);
    const [isValidating, setIsValidating] = useState(false);

    // Enhanced task validation handler - much simpler now
    const handleValidateTask = useCallback(async (taskId, event) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        if (isValidating) return;

        try {
            setIsValidating(true);
            console.log("[VALIDATE] Starting validation for task:", taskId);

            await validateTask(sessionId, taskId);

            console.log("[VALIDATE] Validation completed successfully");
        } catch (err) {
            console.error('[VALIDATE] Validation error:', err);
        } finally {
            setIsValidating(false);
        }
    }, [sessionId, validateTask, isValidating]);

    const toggleHint = (taskId) => {
        setShowHints(prev => ({
            ...prev,
            [taskId]: !prev[taskId]
        }));
    };

    // Get task status and validation result from session
    const getTaskData = useCallback((taskId) => {
        if (!session || !session.tasks) {
            return { status: 'pending', validationResult: null };
        }
        const task = session.tasks.find(t => t.id === taskId);
        return {
            status: task ? task.status : 'pending',
            validationResult: task ? task.validationResult : null
        };
    }, [session]);

    // Fetch scenario effect
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
                clearError();
            } catch (err) {
                handleError(err, 'fetch-scenario');
            } finally {
                setLoading(false);
            }
        };

        fetchScenario();
    }, [scenarioId]);

    // Memoize current task
    const currentTask = useMemo(() => {
        const tasks = scenario?.tasks || [];
        return tasks[activeTaskIndex];
    }, [scenario?.tasks, activeTaskIndex]);

    // Get current task data from session
    const currentTaskData = useMemo(() => {
        return currentTask ? getTaskData(currentTask.id) : { status: 'pending', validationResult: null };
    }, [currentTask, getTaskData]);

    if ((loading || sessionLoading) && !scenario && !session) {  // Only show loading if we have no data
        return <LoadingState message="Loading scenario details..." />;
    }

    if (error) {
        return (
            <ErrorState
                message="Failed to load scenario"
                details={error.message}
                onRetry={() => {
                    clearError();
                    window.location.reload();
                }}
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
                        const taskData = getTaskData(task.id);
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
                                    <StatusIndicator status={taskData.status} size="sm" />
                                    <span className="ml-1 text-xs sm:text-sm">Task {index + 1}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Progress summary */}
            {session && session.tasks && session.tasks.length > 0 && (
                <ValidationDisplay
                    mode="summary"
                    validationResult={{
                        success: session.tasks.every(t => t.status === 'completed'),
                        details: session.tasks.map(t => ({ passed: t.status === 'completed' }))
                    }}
                    compact={true}
                />
            )}

            {/* Task content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-3 sm:p-6">
                    <div className="flex justify-between items-start mb-4">
                        <h2 className="text-lg sm:text-xl font-medium text-gray-900 truncate">{currentTask?.title}</h2>
                        <StatusIndicator
                            status={currentTaskData.status}
                            label={currentTaskData.status === 'completed' ? 'Completed' :
                                currentTaskData.status === 'failed' ? 'Failed' : 'Pending'}
                        />
                    </div>

                    <Card className="mb-6">
                        <div className="prose prose-sm sm:prose-base prose-indigo max-w-none">
                            <ReactMarkdown>{currentTask?.description}</ReactMarkdown>
                        </div>
                    </Card>

                    {/* Hints */}
                    {currentTask?.hints && currentTask.hints.length > 0 && (
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

                    {/* Validation Objectives */}
                    {currentTask?.validation && currentTask.validation.length > 0 && (
                        <div className="mb-6">
                            <ValidationDisplay
                                mode="objectives"
                                validationRules={currentTask.validation}
                                validationResult={currentTaskData.validationResult}
                            />
                        </div>
                    )}

                    {/* Overall validation result */}
                    {currentTaskData.validationResult && (
                        <ValidationDisplay
                            mode="detailed"
                            validationResult={currentTaskData.validationResult}
                            onRetry={() => handleValidateTask(currentTask.id)}
                        />
                    )}

                    {/* Validation button */}
                    <div className="pt-4">
                        <Button
                            type="button"
                            variant="primary"
                            onClick={() => handleValidateTask(currentTask.id)}
                            isLoading={isValidating}
                            disabled={isValidating || currentTaskData.status === 'completed'}
                            className="w-full sm:w-auto"
                        >
                            {isValidating ? 'Validating...' : 'Validate Task'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TaskPanel;