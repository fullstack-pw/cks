// frontend/components/TaskPanel.js
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSession } from '../hooks/useSession';
import { Button, Card, ErrorState, LoadingState, StatusIndicator } from './common';
import ValidationProgress from './ValidationProgress';
import ValidationResult from './ValidationResult';
import ValidationSummary from './ValidationSummary';

const validationStages = [
    { name: 'Connecting to cluster', message: 'Establishing connection...' },
    { name: 'Checking resources', message: 'Verifying Kubernetes resources...' },
    { name: 'Validating configuration', message: 'Checking task requirements...' },
    { name: 'Final verification', message: 'Completing validation...' }
];

const TaskPanel = ({ sessionId, scenarioId }) => {
    console.log("[TASK_PANEL] Component rendered, sessionId:", sessionId);
    const { session, validateTask } = useSession(sessionId);
    const [scenario, setScenario] = useState(null);
    const [activeTaskIndex, setActiveTaskIndex] = useState(0);
    const [showHints, setShowHints] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showAllTasks, setShowAllTasks] = useState(false);
    const currentValidationRequestRef = useRef(null);

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

    const [validationState, setValidationState] = useState({
        isValidating: false,
        result: null,
        progress: null,
        rules: null,
        error: null
    });

    // Simplified ValidationObjectives component without React.memo
    const ValidationObjectives = ({ rules, validationResult }) => {
        console.log("[VALIDATION_OBJECTIVES] Rendering with:", {
            hasRules: !!rules?.length,
            rulesCount: rules?.length || 0,
            hasResult: !!validationResult,
            resultSuccess: validationResult?.success,
            resultDetails: validationResult?.details?.length || 0,
            resultDetailsRules: validationResult?.details?.map(d => d.rule) || []
        });

        if (!rules || rules.length === 0) {
            console.log("ValidationObjectives - No rules to display");
            return null;
        }

        // Helper function to find validation detail for a rule
        const findValidationDetail = (ruleId) => {
            if (!validationResult || !validationResult.details || !validationResult.details.length) {
                return null;
            }

            console.log("[VALIDATION_OBJECTIVES] Matching rule:", ruleId);
            console.log("[VALIDATION_OBJECTIVES] Available details:", validationResult.details.map(d => d.rule));

            // Try direct match
            let detail = validationResult.details.find(detail => detail.rule === ruleId);

            // If no exact match, try to find a detail that might be related
            if (!detail && ruleId) {
                // Look for partial matches (e.g., if ruleId has prefixes/suffixes)
                detail = validationResult.details.find(detail =>
                    detail.rule && (detail.rule.includes(ruleId) || ruleId.includes(detail.rule))
                );
            }

            console.log("[VALIDATION_OBJECTIVES] Match found:", !!detail, detail);
            return detail;
        };

        return (
            <Card className="mb-6 border-blue-200 bg-blue-50">
                <div className="p-4">
                    <h3 className="text-sm font-medium text-blue-900 mb-3">
                        Validation Objectives ({rules.length} checks)
                        {validationResult && <span className="ml-2 text-xs">
                            {validationResult.success ? '✅ All passed' : '❌ Some failed'}
                        </span>}
                    </h3>
                    <div className="space-y-3">
                        {rules.map((rule, index) => {
                            // Find validation detail for this rule
                            const validationDetail = findValidationDetail(rule.id);
                            const validationStatus = validationDetail
                                ? (validationDetail.passed ? 'completed' : 'failed')
                                : 'pending';

                            return (
                                <div key={rule.id} className={`flex items-start p-2 rounded-md ${validationStatus === 'completed' ? 'bg-green-100 border border-green-200' :
                                    validationStatus === 'failed' ? 'bg-red-100 border border-red-200' :
                                        'bg-gray-100 border border-gray-200'
                                    }`}>
                                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mr-3 
                                    ${validationStatus === 'completed' ? 'bg-green-500' :
                                            validationStatus === 'failed' ? 'bg-red-500' : 'bg-gray-400'}`}>
                                        {validationStatus === 'completed' ? (
                                            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        ) : validationStatus === 'failed' ? (
                                            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        ) : (
                                            <span className="text-sm font-medium text-white">{index + 1}</span>
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center">
                                            <p className={`text-sm font-medium ${validationStatus === 'completed' ? 'text-green-800' :
                                                validationStatus === 'failed' ? 'text-red-800' :
                                                    'text-gray-800'
                                                }`}>
                                                {getValidationObjectiveDescription(rule)}
                                            </p>
                                            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${validationStatus === 'completed' ? 'bg-green-200 text-green-800' :
                                                validationStatus === 'failed' ? 'bg-red-200 text-red-800' :
                                                    'bg-gray-200 text-gray-800'
                                                }`}>
                                                {validationStatus === 'completed' ? 'Passed' :
                                                    validationStatus === 'failed' ? 'Failed' : 'Pending'}
                                            </span>
                                        </div>

                                        {/* Show rule details */}
                                        {rule.description && (
                                            <p className="text-xs text-gray-600 mt-1">{rule.description}</p>
                                        )}

                                        {/* Show validation message */}
                                        {validationDetail && (
                                            <div className={`mt-2 text-xs p-1.5 rounded ${validationDetail.passed ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                                                }`}>
                                                <strong>{validationDetail.passed ? 'Success: ' : 'Error: '}</strong>
                                                {validationDetail.message}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </Card>
        );
    };

    // Enhanced task validation handler
    const handleValidateTask = useCallback(async (taskId, event) => {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        // Generate a unique request ID for this validation
        const requestId = `${taskId}-${Date.now()}`;
        currentValidationRequestRef.current = requestId;

        // Get validation rules upfront before starting validation
        let rules = [];
        if (scenario && scenario.tasks) {
            const taskForValidation = scenario.tasks.find(t => t.id === taskId);
            if (taskForValidation && taskForValidation.validation) {
                rules = taskForValidation.validation;
                console.log("[VALIDATE] Found validation rules:", rules.length);
            }
        }

        let progressInterval;
        let progressTimeout;
        let currentStage = 0;

        try {
            console.log("[VALIDATE] Starting validation with rules:", rules.length);

            // Set initial validation state
            setValidationState({
                isValidating: true,
                result: null, // Clear previous result
                progress: {
                    stages: validationStages,
                    currentStage: 0
                },
                rules: rules,
                error: null
            });

            // Create progress simulation interval
            progressInterval = setInterval(() => {
                // Check if this is still the current validation request
                if (currentValidationRequestRef.current !== requestId) {
                    clearInterval(progressInterval);
                    return;
                }

                currentStage = Math.min(currentStage + 1, validationStages.length - 1);
                setValidationState(prev => ({
                    ...prev,
                    progress: {
                        stages: validationStages,
                        currentStage: currentStage
                    }
                }));
            }, 1000);

            // Set a maximum timeout for validation (30 seconds)
            const timeoutPromise = new Promise((_, reject) => {
                progressTimeout = setTimeout(() => {
                    reject(new Error('Validation timeout - took too long to complete'));
                }, 30000);
            });

            // Execute validation with timeout
            const result = await Promise.race([
                validateTask(sessionId, taskId),
                timeoutPromise
            ]);

            console.log("[VALIDATE] Validation result received:", {
                success: result?.success,
                detailsCount: result?.details?.length,
                details: result?.details?.map(d => ({ rule: d.rule, passed: d.passed }))
            });

            // Only update if this is still the current validation request
            if (currentValidationRequestRef.current !== requestId) {
                console.log("[VALIDATE] Validation result ignored - newer validation in progress");
                return result;
            }

            // Update state with result - force re-render by creating new object
            console.log("[VALIDATE] Updating validation state with result");
            setValidationState({
                isValidating: false,
                result: result, // Set the result directly
                progress: null,
                rules: rules, // Keep the rules
                error: null
            });

            console.log("[VALIDATE] State updated successfully");
            return result;
        } catch (err) {
            console.error('[VALIDATE] Validation error:', err);

            if (currentValidationRequestRef.current !== requestId) {
                console.log("[VALIDATE] Validation error ignored - newer validation in progress");
                return null;
            }

            // Handle error case
            setValidationState({
                isValidating: false,
                result: {
                    success: false,
                    message: err.message || 'Validation failed due to an unexpected error',
                    details: []
                },
                progress: null,
                rules: rules,
                error: err.message || 'Validation failed due to an unexpected error'
            });

            return null;
        } finally {
            // Ensure interval and timeout are cleared
            if (progressInterval) {
                clearInterval(progressInterval);
            }
            if (progressTimeout) {
                clearTimeout(progressTimeout);
            }
        }
    }, [sessionId, validateTask, scenario, validationStages]);

    const toggleHint = (taskId) => {
        setShowHints(prev => ({
            ...prev,
            [taskId]: !prev[taskId]
        }));
    };

    const getTaskStatus = (taskId) => {
        if (!session || !session.tasks) return 'pending';

        const task = session.tasks.find(t => t.id === taskId);
        return task ? task.status : 'pending';
    };

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

                // Initialize validation state with rules from the first task
                if (data && data.tasks && data.tasks.length > 0) {
                    const initialTask = data.tasks[0];
                    if (initialTask.validation) {
                        setValidationState(prev => ({
                            ...prev,
                            rules: initialTask.validation
                        }));
                    }
                }

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
        if (!scenario || !scenario.tasks || scenario.tasks.length === 0) return;

        // Get the current task
        const currentTask = scenario.tasks[activeTaskIndex];
        if (!currentTask) return;

        // Only clear validation results if we're actually changing to a different task
        setValidationState(prev => {
            const isTaskChange = prev.currentTaskId && prev.currentTaskId !== currentTask.id;

            return {
                ...prev,
                currentTaskId: currentTask.id,
                result: isTaskChange ? null : prev.result, // Keep result if same task
                error: isTaskChange ? null : prev.error,   // Keep error if same task
                rules: currentTask.validation || []
            };
        });
    }, [activeTaskIndex, scenario]);

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
                    {validationState.isValidating && validationState.progress && (
                        <ValidationProgress
                            stages={validationState.progress.stages}
                            currentStage={validationState.progress.currentStage}
                        />
                    )}

                    {/* ValidationObjectives - now renders properly */}
                    {validationState.rules && validationState.rules.length > 0 && (
                        <div className="mb-6">
                            <ValidationObjectives
                                rules={validationState.rules}
                                validationResult={validationState.result}
                            />
                        </div>
                    )}

                    {/* Overall validation result */}
                    {validationState.result && (
                        <ValidationResult
                            result={validationState.result}
                            onRetry={() => handleValidateTask(currentTask.id)}
                            scenarioId={scenarioId}
                        />
                    )}

                    {/* Validation button */}
                    <div className="pt-4">
                        <Button
                            type="button"
                            variant="primary"
                            onClick={() => handleValidateTask(currentTask.id)}
                            isLoading={validationState.isValidating}
                            disabled={validationState.isValidating || getTaskStatus(currentTask.id) === 'completed'}
                            className="w-full sm:w-auto"
                        >
                            {validationState.isValidating ? 'Validating...' : 'Validate Task'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TaskPanel;