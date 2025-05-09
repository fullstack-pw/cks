// frontend/components/ScenarioCard.js (updated)
import React from 'react';
import Card from './common/Card';
import Button from './common/Button';
import StatusIndicator from './common/StatusIndicator';

const ScenarioCard = ({ scenario, categoryLabels = {}, onStart, isCreatingSession }) => {
    if (!scenario) return null;

    const { id, title, description, difficulty, timeEstimate, topics = [] } = scenario;

    // Create card header with title and difficulty
    const header = (
        <div className="flex justify-between items-start">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            <div className="ml-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${difficulty === 'beginner' ? 'bg-green-100 text-green-800' :
                        difficulty === 'intermediate' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                    }`}>
                    {difficulty}
                </span>
            </div>
        </div>
    );

    // Create card footer with button
    const footer = (
        <Button
            onClick={() => onStart(id)}
            disabled={isCreatingSession}
            isLoading={isCreatingSession}
            variant="primary"
            className="w-full"
        >
            Start Lab
        </Button>
    );

    return (
        <Card header={header} footer={footer}>
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
        </Card>
    );
};

export default ScenarioCard;