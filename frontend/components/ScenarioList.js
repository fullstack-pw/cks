// frontend/components/ScenarioList.js - List of available scenarios

import React, { useState } from 'react';
import { useRouter } from 'next/router';
import useScenario from '../hooks/useScenario';
import useSession from '../hooks/useSession';

const ScenarioList = () => {
    const router = useRouter();
    const { scenarios, categories, isLoading, isError } = useScenario();
    const { createSession } = useSession();
    const [categoryFilter, setCategoryFilter] = useState('');
    const [difficultyFilter, setDifficultyFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [isCreatingSession, setIsCreatingSession] = useState(false);

    // Filter scenarios
    const filteredScenarios = scenarios?.filter((scenario) => {
        // Category filter
        if (categoryFilter && !scenario.topics.includes(categoryFilter)) {
            return false;
        }

        // Difficulty filter
        if (difficultyFilter && scenario.difficulty !== difficultyFilter) {
            return false;
        }

        // Search query
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            return (
                scenario.title.toLowerCase().includes(query) ||
                scenario.description.toLowerCase().includes(query) ||
                scenario.topics.some((topic) => topic.toLowerCase().includes(query))
            );
        }

        return true;
    });

    // Start a scenario
    const handleStartScenario = async (scenarioId) => {
        setIsCreatingSession(true);
        try {
            const result = await createSession(scenarioId);
            router.push(`/lab/${result.sessionId}`);
        } catch (error) {
            console.error('Failed to create session:', error);
            alert('Failed to create session. Please try again.');
        } finally {
            setIsCreatingSession(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    if (isError) {
        return (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                <p>Failed to load scenarios. Please try again later.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg shadow p-6">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                        <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
                            Search
                        </label>
                        <input
                            type="text"
                            id="search"
                            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            placeholder="Search scenarios..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div className="w-full md:w-1/4">
                        <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
                            Category
                        </label>
                        <select
                            id="category"
                            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            value={categoryFilter}
                            onChange={(e) => setCategoryFilter(e.target.value)}
                        >
                            <option value="">All Categories</option>
                            {categories && Object.entries(categories).map(([key, value]) => (
                                <option key={key} value={key}>
                                    {value}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="w-full md:w-1/4">
                        <label htmlFor="difficulty" className="block text-sm font-medium text-gray-700 mb-1">
                            Difficulty
                        </label>
                        <select
                            id="difficulty"
                            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            value={difficultyFilter}
                            onChange={(e) => setDifficultyFilter(e.target.value)}
                        >
                            <option value="">All Difficulties</option>
                            <option value="beginner">Beginner</option>
                            <option value="intermediate">Intermediate</option>
                            <option value="advanced">Advanced</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredScenarios?.map((scenario) => (
                    <div
                        key={scenario.id}
                        className="bg-white rounded-lg shadow overflow-hidden hover:shadow-md transition-shadow"
                    >
                        <div className="p-6">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="text-lg font-medium text-gray-900">{scenario.title}</h3>
                                <span
                                    className={`px-2 py-1 rounded-full text-xs font-medium ${scenario.difficulty === 'beginner'
                                            ? 'bg-green-100 text-green-800'
                                            : scenario.difficulty === 'intermediate'
                                                ? 'bg-yellow-100 text-yellow-800'
                                                : 'bg-red-100 text-red-800'
                                        }`}
                                >
                                    {scenario.difficulty}
                                </span>
                            </div>
                            <p className="text-gray-500 text-sm mb-4">{scenario.description}</p>
                            <div className="flex items-center text-sm text-gray-500 mb-4">
                                <svg
                                    className="h-5 w-5 mr-1"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                </svg>
                                <span>{scenario.timeEstimate}</span>
                            </div>
                            <div className="flex flex-wrap gap-1 mb-4">
                                {scenario.topics.map((topic) => (
                                    <span
                                        key={topic}
                                        className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full"
                                    >
                                        {categories?.[topic] || topic}
                                    </span>
                                ))}
                            </div>
                            <button
                                onClick={() => handleStartScenario(scenario.id)}
                                disabled={isCreatingSession}
                                className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isCreatingSession ? 'Creating...' : 'Start Lab'}
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {filteredScenarios?.length === 0 && (
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 text-center">
                    <p className="text-gray-500">No scenarios found matching your filters</p>
                </div>
            )}
        </div>
    );
};

export default ScenarioList;