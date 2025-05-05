// frontend/components/TaskPanel.js - Panel for displaying and validating tasks

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import useSession from '../hooks/useSession';

const TaskPanel = ({ session, scenario }) => {
    const [activeTaskIndex, setActiveTaskIndex] = useState(0);
    const [showHints, setShowHints] = useState({});
    const [validationInProgress, setValidationInProgress] = useState(null);
    const { validateTask } = useSession(session?.id);

    if (!session || !scenario) {
        return (
            <div className="flex h-full items-center justify-center">
                <p className="text-gray-500">Loading tasks...</p>
            </div>
        );
    }

    const tasks = scenario.tasks;
    const taskStatuses = session.tasks || [];

    // Get task status map
    const taskStatusMap = taskStatuses.reduce((map, status) => {
        map[status.id] = status;
        return map;
    }, {});

    // Handle task validation
    const handleValidateTask = async (taskId) => {
        setValidationInProgress(taskId);
        try {
            const result = await validateTask(taskId);
            return result;
        } catch (error) {
            console.error('Validation failed:', error);
            return { success: false, message: 'Validation failed' };
        } finally {
            setValidationInProgress(null);
        }
    };

    // Toggle hint visibility
    const toggleHint = (taskId) => {
        setShowHints((prev) => ({
            ...prev,
            [taskId]: !prev[taskId],
        }));
    };

    // No tasks available
    if (tasks.length === 0) {
        return (
            <div className="h-full flex items-center justify-center">
                <p className="text-gray-500">No tasks available for this scenario</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            <div className="border-b border-gray-200">
                <nav className="flex" aria-label="Tasks">
                    {tasks.map((task, index) => {
                        const status = taskStatusMap[task.id]?.status || 'pending';
                        return (
                            <button
                                key={task.id}
                                onClick={() => setActiveTaskIndex(index)}
                                className={`px-4 py-3 text-sm font-medium border-b-2 ${activeTaskIndex === index
                                        ? 'border-indigo-500 text-indigo-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    } ${status === 'completed'
                                        ? 'text-green-600'
                                        : status === 'failed'
                                            ? 'text-red-600'
                                            : ''
                                    }`}
                            >
                                {status === 'completed' && (
                                    <svg
                                        className="inline-block h-4 w-4 mr-1"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M5 13l4 4L19 7"
                                        />
                                    </svg>
                                )}
                                Task {index + 1}
                            </button>
                        );
                    })}
                </nav>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                {tasks.map((task, index) => {
                    if (index !== activeTaskIndex) return null;

                    const status = taskStatusMap[task.id]?.status || 'pending';
                    const statusMessage = taskStatusMap[task.id]?.message || '';

                    return (
                        <div key={task.id} className="space-y-4">
                            <div className="flex justify-between items-start">
                                <h2 className="text-xl font-medium text-gray-900">{task.title}</h2>
                                {status === 'completed' && (
                                    <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                                        Completed
                                    </span>
                                )}
                                {status === 'failed' && (
                                    <span className="px-2 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-full">
                                        Failed
                                    </span>
                                )}
                            </div>

                            <div className="prose prose-indigo max-w-none">
                                <ReactMarkdown>{task.description}</ReactMarkdown>
                            </div>

                            {task.hints && task.hints.length > 0 && (
                                <div>
                                    <button
                                        onClick={() => toggleHint(task.id)}
                                        className="text-sm text-indigo-600 hover:text-indigo-800"
                                    >
                                        {showHints[task.id] ? 'Hide Hints' : 'Show Hints'}
                                    </button>

                                    {showHints[task.id] && (
                                        <div className="mt-2 bg-indigo-50 p-4 rounded-md">
                                            <h3 className="text-sm font-medium text-indigo-800 mb-2">Hints</h3>
                                            <ul className="list-disc pl-5 space-y-1">
                                                {task.hints.map((hint, hintIndex) => (
                                                    <li key={hintIndex} className="text-sm text-indigo-700">
                                                        {hint}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}

                            {statusMessage && (
                                <div
                                    className={`p-4 rounded-md ${status === 'completed' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                                        }`}
                                >
                                    <p>{statusMessage}</p>
                                </div>
                            )}

                            <div className="pt-4">
                                <button
                                    onClick={() => handleValidateTask(task.id)}
                                    disabled={validationInProgress === task.id}
                                    className="bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {validationInProgress === task.id ? 'Validating...' : 'Validate Task'}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default TaskPanel;