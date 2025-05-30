// frontend/components/TaskPanel.js
import React, { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSession } from '../hooks/useSession';
import { Button, Card, ErrorState, LoadingState, StatusIndicator } from './common';
import TaskValidation from './TaskValidation';
import { useError } from '../hooks/useError';

const TaskPanel = ({ sessionId, scenarioId }) => {
    const { session, isLoading: sessionLoading } = useSession(sessionId);
    const [scenario, setScenario] = useState(null);
    const [activeTaskIndex, setActiveTaskIndex] = useState(0);
    const [showHints, setShowHints] = useState({});
    const [loading, setLoading] = useState(true);
    const { error, handleError, clearError } = useError('task-panel');
    const [showAllTasks, setShowAllTasks] = useState(false);

    const toggleHint = (taskId) => {
        setShowHints(prev => ({
            ...prev,
            [taskId]: !prev[taskId]
        }));
    };

    // Get task status from session (simplified)
    const getTaskStatus = useMemo(() => {
        if (!session || !session.tasks) {
            return (taskId) => 'pending';
        }
        return (taskId) => {
            const task = session.tasks.find(t => t.id === taskId);
            return task ? task.status : 'pending';
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
    }, [scenarioId, handleError, clearError]);

    // Memoize current task
    const currentTask = useMemo(() => {
        const tasks = scenario?.tasks || [];
        return tasks[activeTaskIndex];
    }, [scenario?.tasks, activeTaskIndex]);

    // Handle validation completion
    const handleValidationComplete = (result) => {
        console.log('Validation completed:', result);
        // The session will be updated via SWR, no manual updates needed
    };

    if ((loading || sessionLoading) && !scenario && !session) {
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
                        const taskStatus = getTaskStatus(task.id);
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
                                    <StatusIndicator status={taskStatus} size="sm" />
                                    <span className="ml-1 text-xs sm:text-sm">Task {index + 1}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Progress summary */}
            {session && session.tasks && session.tasks.length > 0 && (
                <div className="p-3 bg-gray-50 border-b">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">Overall Progress</span>
                        <div className="flex items-center space-x-2">
                            <span className="text-sm text-gray-600">
                                {session.tasks.filter(t => t.status === 'completed').length}/{session.tasks.length} completed
                            </span>
                            <div className="w-16 bg-gray-200 rounded-full h-2">
                                <div
                                    className="bg-green-500 h-2 rounded-full transition-all duration-300"
                                    style={{
                                        width: `${(session.tasks.filter(t => t.status === 'completed').length / session.tasks.length) * 100}%`
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Task content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-3 sm:p-6">
                    <div className="flex justify-between items-start mb-4">
                        <h2 className="text-lg sm:text-xl font-medium text-gray-900 truncate">{currentTask?.title}</h2>
                        <StatusIndicator
                            status={getTaskStatus(currentTask?.id)}
                            label={getTaskStatus(currentTask?.id) === 'completed' ? 'Completed' :
                                getTaskStatus(currentTask?.id) === 'failed' ? 'Failed' : 'Pending'}
                        />
                    </div>

                    {/* Task Description */}
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

                    {/* NEW: Unified Task Validation Component */}
                    {currentTask && (
                        <TaskValidation
                            taskId={currentTask.id}
                            sessionId={sessionId}
                            validationRules={currentTask.validation || []}
                            onValidationComplete={handleValidationComplete}
                            className="mb-6"
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default TaskPanel;