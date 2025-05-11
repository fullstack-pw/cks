// frontend/components/ScenarioCard.js
import React from 'react';
import { Card, Button, StatusIndicator } from './common';

const ScenarioCard = ({ scenario, categoryLabels = {}, onStart, isCreatingSession }) => {
    if (!scenario) return null;

    const { id, title, description, difficulty, timeEstimate, topics = [] } = scenario;

    // Map difficulty to status for visual indicator
    const difficultyStatus = {
        'beginner': 'connected', // green
        'intermediate': 'pending', // yellow
        'advanced': 'failed' // red
    };

    // Create card header with title and difficulty
    const header = (
        <div className="flex justify-between items-start">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate" title={title}>
                {title}
            </h3>
            <StatusIndicator
                status={difficultyStatus[difficulty] || 'pending'}
                label={difficulty}
                size="sm"
            />
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
        <Card
            header={header}
            footer={footer}
            className="h-full flex flex-col"
        >
            <div className="flex-1 flex flex-col">
                <p className="text-gray-600 text-xs sm:text-sm mb-4 line-clamp-2" title={description}>
                    {description}
                </p>

                <div className="flex items-center text-gray-500 text-xs sm:text-sm mb-4">
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

                <div className="flex flex-wrap gap-1 mt-auto overflow-hidden">
                    {topics.slice(0, 3).map(topic => (
                        <span
                            key={topic}
                            className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full truncate"
                            title={categoryLabels[topic] || topic}
                        >
                            {categoryLabels[topic] || topic}
                        </span>
                    ))}
                    {topics.length > 3 && (
                        <span className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full">
                            +{topics.length - 3} more
                        </span>
                    )}
                </div>
            </div>
        </Card>
    );
};

export default ScenarioCard;