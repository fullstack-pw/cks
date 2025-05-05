// frontend/hooks/useScenario.js - Hook for managing scenario data

import useSWR from 'swr';

// API fetcher function
const fetcher = async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
        const error = new Error('Failed to fetch data');
        error.status = response.status;
        throw error;
    }
    return response.json();
};

export function useScenario(scenarioId) {
    // Fetch scenario data
    const { data, error, mutate } = useSWR(
        scenarioId ? `/api/v1/scenarios/${scenarioId}` : null,
        fetcher
    );

    // Fetch all scenarios
    const { data: allScenarios, error: allScenariosError } = useSWR(
        '/api/v1/scenarios',
        fetcher
    );

    // Fetch categories
    const { data: categories, error: categoriesError } = useSWR(
        '/api/v1/scenarios/categories',
        fetcher
    );

    return {
        scenario: data,
        scenarios: allScenarios,
        categories: categories,
        isLoading: (!error && !data) || (!allScenariosError && !allScenarios),
        isError: error || allScenariosError || categoriesError,
        refresh: mutate,
    };
}

export default useScenario;