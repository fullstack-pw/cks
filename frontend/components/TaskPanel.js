// frontend/components/TaskPanel.js
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
    const resultRef = useRef(null);
    const [forceUpdate, setForceUpdate] = useState(0);
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

    //Helper functions
    const ValidationObjectives = React.memo(({ rules, validationResult }) => {
        console.log("ValidationObjectives component RENDER with:", {
            hasRules: !!rules?.length,
            hasResult: !!validationResult,
            resultDetails: validationResult?.details?.length || 0
        });

        useEffect(() => {
            console.log("ValidationObjectives effect ran with validationResult:", validationResult);
        }, [validationResult]);

        if (!rules || rules.length === 0) {
            console.log("ValidationObjectives - No rules to display");
            return null;
        }

        console.log("ValidationObjectives - rules:", rules);
        console.log("ValidationObjectives - validationResult:", validationResult);

        // Helper function to find validation detail for a rule with better debugging
        const findValidationDetail = (ruleId) => {
            if (!validationResult || !validationResult.details) {
                console.log(`No validation details available for rule: ${ruleId}`);
                return null;
            }

            const detail = validationResult.details.find(detail => detail.rule === ruleId);

            if (!detail) {
                console.log(`No matching validation detail found for rule: ${ruleId}`);
                console.log(`Available validation details:`, validationResult.details.map(d => d.rule));
            } else {
                console.log(`Found validation detail for rule: ${ruleId}`, detail);
            }

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
    });

    // Handle task validation
    const handleValidateTask = useCallback(async (taskId) => {
        console.log('[TaskPanel] Starting validation for task:', taskId);
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        setValidating(true);
        setValidationResult(null); // Clearing previous validation result
        console.log('[TaskPanel] Reset validation result state to null');

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
        console.log('[TaskPanel] Set initial validation progress stage');

        try {
            console.log('[TaskPanel] Calling validateTask with:', { sessionId, taskId });

            // Simulate progress through stages
            const progressInterval = setInterval(() => {
                setValidationProgress(prev => {
                    if (!prev || prev.currentStage >= prev.stages.length - 1) {
                        clearInterval(progressInterval); // Clear interval if we've reached the end
                        return prev;
                    }
                    return {
                        ...prev,
                        currentStage: prev.currentStage + 1
                    };
                });
            }, 1000);

            const result = await validateTask(sessionId, taskId);
            clearInterval(progressInterval); // Ensure interval is cleared when done

            console.log('[TaskPanel] Validation result received:', result);
            console.log('[TaskPanel] Validation success:', result.success);
            console.log('[TaskPanel] Validation details:', result.details);

            // Ensure validationRules are updated with the current task if needed
            if (scenario && scenario.tasks) {
                const taskForValidation = scenario.tasks.find(t => t.id === taskId);
                if (taskForValidation && taskForValidation.validation) {
                    console.log('[TaskPanel] Using validation rules from task:', taskId);
                    console.log('[TaskPanel] Validation rules:', taskForValidation.validation);
                    setValidationRules(taskForValidation.validation);
                }
            }

            // Set validation result after everything is ready
            console.log('[TaskPanel] Setting validation result in state');
            resultRef.current = result;  // Store in ref for immediate access
            setValidationResult(result); // Update state
            setForceUpdate(prev => prev + 1); // Force a re-render
            setValidationProgress(null);

            console.log("[TaskPanel] validationResult in ref:", resultRef.current);
            console.log("[TaskPanel] validationResult in state:", validationResult);
            console.log('[TaskPanel] Validation result set in state, component should re-render');

            return result;
        } catch (err) {
            // Handle error locally
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
    }, [sessionId, validateTask, scenario, validationResult, setValidationResult, setValidationRules, setForceUpdate]);

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
                    console.log(`[TaskPanel] Loaded ${taskFromScenario.validation.length} validation rules for task ${currentTask.id}`,
                        taskFromScenario.validation);
                    setValidationRules(taskFromScenario.validation);

                    // Clear previous validation result when changing tasks
                    setValidationResult(null);
                } else {
                    console.log(`[TaskPanel] No validation rules found for task ${currentTask.id}`);
                    setValidationRules([]);
                }
            } catch (err) {
                console.error('Error fetching validation rules:', err);
                setValidationRules([]);
            }
        };

        fetchValidationRules();
    }, [activeTaskIndex, scenario]);

    useEffect(() => {
        if (validationResult) {
            console.log("[TaskPanel] validationResult state changed:", validationResult);
            console.log("[TaskPanel] validationResult details count:", validationResult.details?.length);
            // Force refresh of ValidationObjectives
            setValidationRules(prevRules => [...prevRules]); // Create a new array reference
        }
    }, [validationResult]);
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
                    {validationResult && (
                        <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs">
                            <details>
                                <summary className="cursor-pointer font-medium">Debug Info</summary>
                                <pre className="mt-2 whitespace-pre-wrap">
                                    {JSON.stringify({
                                        taskId: currentTask.id,
                                        resultSuccess: validationResult.success,
                                        resultDetails: validationResult.details.map(d => ({
                                            rule: d.rule,
                                            passed: d.passed
                                        })),
                                        rules: validationRules.map(r => r.id)
                                    }, null, 2)}
                                </pre>
                            </details>
                        </div>
                    )}
                    {validationRules && validationRules.length > 0 && (
                        <div className="mb-6" key={`validation-section-${forceUpdate}`}>
                            <div>
                                {/* Debug information to verify data */}
                                <div className="text-xs text-gray-500 mb-2">
                                    {validationResult || resultRef.current ? (
                                        `Validation completed: ${(validationResult || resultRef.current)?.success ? 'Success' : 'Failed'} 
          (${(validationResult || resultRef.current)?.details?.length || 0} details)`
                                    ) : (
                                        'No validation result yet'
                                    )}
                                </div>

                                <ValidationObjectives
                                    key={`validation-objectives-${currentTask.id}-${forceUpdate}`}
                                    rules={validationRules}
                                    validationResult={resultRef.current}
                                />
                            </div>
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