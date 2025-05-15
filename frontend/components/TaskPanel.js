// frontend/components/TaskPanel.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSession } from '../hooks/useSession';
import { Button, Card, ErrorState, LoadingState, StatusIndicator } from './common';
import ValidationProgress from './ValidationProgress';
import ValidationResult from './ValidationResult';
import ValidationSummary from './ValidationSummary';

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
    const [validationRules, setValidationRules] = useState(null);
    const [showObjectives, setShowObjectives] = useState(false);

    const getValidationObjectiveDescription = (rule) => {
        switch (rule.type) {
            case 'resource_exists':
                return `${rule.resource.kind} "${rule.resource.name}" must exist in namespace "${rule.resource.namespace || 'default'}"`;

            case 'resource_property':
                return `${rule.resource.kind} "${rule.resource.name}" property ${rule.resource.property} must ${rule.condition} ${rule.value}`;

            case 'command':
                return `Command must ${rule.condition === 'success' ? 'execute successfully' : `have output that ${rule.condition} "${rule.value}"`}`;

            case 'script':
                return `Custom validation script must pass`;

            case 'file_exists':
                return `File "${rule.file.path}" must exist on ${rule.file.target}`;

            case 'file_content':
                return `File "${rule.file.path}" must ${rule.condition} "${rule.value}"`;

            default:
                return rule.description || rule.errorMessage || 'Custom validation';
        }
    };

    // Hooks
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

    useEffect(() => {
        const fetchValidationRules = async () => {
            if (!scenario || !scenario.tasks || scenario.tasks.length === 0) return;

            const currentTask = scenario.tasks[activeTaskIndex];
            if (!currentTask) return;

            try {
                // Extract validation info from the scenario data
                const taskFromScenario = scenario.tasks.find(t => t.id === currentTask.id);
                if (taskFromScenario && taskFromScenario.validation) {
                    setValidationRules(taskFromScenario.validation);
                    console.log('Validation rules:', taskFromScenario.validation);
                }
            } catch (err) {
                console.error('Error fetching validation rules:', err);
            }
        };

        fetchValidationRules();
    }, [activeTaskIndex, scenario]);

    //Helper functions
    const ValidationObjectives = ({ rules }) => {
        if (!rules || rules.length === 0) return null;

        return (
            <Card className="mb-6 border-blue-200 bg-blue-50">
                <div className="p-4">
                    <h3 className="text-sm font-medium text-blue-900 mb-3">
                        Validation Objectives ({rules.length} checks)
                    </h3>
                    <div className="space-y-2">
                        {rules.map((rule, index) => (
                            <div key={rule.id} className="flex items-start">
                                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-200 flex items-center justify-center mr-3">
                                    <span className="text-xs font-medium text-blue-800">{index + 1}</span>
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm text-blue-800 font-medium">
                                        {getValidationObjectiveDescription(rule)}
                                    </p>
                                    {rule.description && (
                                        <p className="text-xs text-blue-600 mt-1">{rule.description}</p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </Card>
        );
    };

    // Handle task validation
    const handleValidateTask = useCallback(async (taskId) => {
        console.log('[TaskPanel] Starting validation for task:', taskId);
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

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
            console.log('[TaskPanel] Calling validateTask with:', { sessionId, taskId });
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

            console.log('[TaskPanel] Validation result:', result);
            console.log('[TaskPanel] Validation details:', result.details);

            clearInterval(progressInterval);
            setValidationProgress(null);

            // Add debug logging
            console.log('[TaskPanel] Validation result:', result);
            console.log('[TaskPanel] Validation details:', result.details);

            setValidationResult(result);

            // Don't throw errors here - handle them gracefully
            return result;
        } catch (err) {
            // Handle error locally instead of re-throwing
            setValidationProgress(null);
            console.error('[TaskPanel] Validation error:', err);
            setValidationResult({
                success: false,
                message: err.message || 'Validation failed due to an unexpected error',
                details: []
            });
        } finally {
            setValidating(false);
        }
    }, [sessionId, validateTask]);

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

            {/* Progress summary */}
            {session && session.tasks && (
                <ValidationSummary tasks={session.tasks} />
            )}

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
                    {/* Validation progress */}
                    {validating && validationProgress && (
                        <ValidationProgress
                            stages={validationProgress.stages}
                            currentStage={validationProgress.currentStage}
                        />
                    )}
                    {/* Validation results */}
                    {validationResult && (
                        <ValidationResult
                            result={validationResult}
                            onRetry={() => handleValidateTask(currentTask.id)}
                            scenarioId={scenarioId}
                        />
                    )}
                    {validationRules && validationRules.length > 0 && (
                        <div className="mb-6">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowObjectives(!showObjectives)}
                                className="mb-3"
                            >
                                {showObjectives ? 'Hide Validation Objectives' : 'Show Validation Objectives'}
                                <span className="ml-1 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">
                                    {validationRules.length}
                                </span>
                            </Button>

                            {showObjectives && (
                                <ValidationObjectives rules={validationRules} />
                            )}
                        </div>
                    )}
                    {/* Validation button */}
                    <div className="pt-4">
                        <Button
                            type="button"
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