// frontend/components/ScenarioList.js - Fixed ScenarioList component

import React, { useState } from 'react';
import ScenarioCard from './ScenarioCard';

const ScenarioList = ({ scenarios = [], categories = {}, onStartScenario }) => {
    const [isCreatingSession, setIsCreatingSession] = useState(false);

    // Handle starting a scenario
    const handleStartScenario = async (scenarioId) => {
        if (isCreatingSession) return;

        setIsCreatingSession(true);
        try {
            await onStartScenario(scenarioId);
        } catch (error) {
            console.error('Failed to create session:', error);
        } finally {
            setIsCreatingSession(false);
        }
    };

    if (!scenarios || scenarios.length === 0) {
        return (
            <div className="bg-white shadow rounded-lg p-6 text-center">
                <p className="text-gray-500">No scenarios found matching your filters</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {scenarios.map((scenario) => (
                <ScenarioCard
                    key={scenario.id}
                    scenario={scenario}
                    categoryLabels={categories}
                    onStart={handleStartScenario}
                    isCreatingSession={isCreatingSession}
                />
            ))}
        </div>
    );
};

export default ScenarioList;