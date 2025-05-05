// frontend/components/ScenarioCard.js - Fixed ScenarioCard component

import React from 'react';

const ScenarioCard = ({ scenario, categoryLabels = {}, onStart, isCreatingSession }) => {
    if (!scenario) return null;

    const { id, title, description, difficulty, timeEstimate, topics = [] } = scenario;

    // Map difficulty to color classes
    const difficultyColors = {
        beginner: 'bg-green-100 text-green-800',
        intermediate: 'bg-yellow-100 text-yellow-800',
        advanced: 'bg-red-100 text-red-800'
    };

    // Get color class based on difficulty, default to gray
    const difficultyColor = difficultyColors[difficulty] || 'bg-gray-100 text-gray-800';

    return (
        <div className="border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow bg-white">
            <div className="px-6 py-4">
                <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
                    <span className={`text-xs px-2 py-1 rounded-full ${difficultyColor}`}>
                        {difficulty}
                    </span>
                </div>

                <p className="text-gray-600 text-sm mb-4 line-clamp-2">{description}</p>

                <div className="flex items-center text-gray-500 text-xs mb-4">
                    <svg
                        className="w-4 h-4 mr-1"
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
                    <span>{timeEstimate}</span>
                </div>

                <div className="flex flex-wrap gap-1 mb-4">
                    {topics.map(topic => (
                        <span
                            key={topic}
                            className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full"
                        >
                            {categoryLabels[topic] || topic}
                        </span>
                    ))}
                </div>

                <button
                    onClick={() => onStart(id)}
                    disabled={isCreatingSession}
                    className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isCreatingSession ? 'Creating...' : 'Start Lab'}
                </button>
            </div>
        </div>
    );
};

export default ScenarioCard;