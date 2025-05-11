// frontend/components/ScenarioList.js
import React, { useState } from 'react';
import ScenarioCard from './ScenarioCard';
import { LoadingState, EmptyState, Card } from './common';

const ScenarioList = ({ scenarios = [], categories = {}, onStartScenario, isLoading = false }) => {
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

    if (isLoading) {
        return <LoadingState message="Loading scenarios..." />;
    }

    if (!scenarios || scenarios.length === 0) {
        return (
            <Card className="p-8 text-center">
                <EmptyState
                    title="No scenarios found"
                    message="No scenarios match your current filters."
                    actionText="Clear Filters"
                    onAction={() => window.location.search = ''}
                />
            </Card>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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