// frontend/pages/index.js - Updated to use standardized components

import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import ScenarioFilter from '../components/ScenarioFilter';
import ScenarioList from '../components/ScenarioList';
import api from '../lib/api';
import { useSession } from '../hooks/useSession';
import { PageHeader, ErrorState } from '../components/common';

export default function Home() {
    const router = useRouter();
    const { createSession } = useSession();
    const [scenarios, setScenarios] = useState([]);
    const [categories, setCategories] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState({
        category: '',
        difficulty: '',
        search: ''
    });

    // Fetch scenarios and categories on initial load
    useEffect(() => {
        async function fetchData() {
            try {
                setLoading(true);
                const [scenariosData, categoriesData] = await Promise.all([
                    api.scenarios.list(filters),
                    api.scenarios.categories()
                ]);
                setScenarios(scenariosData);
                setCategories(categoriesData);
                setError(null);
            } catch (err) {
                console.error('Error fetching data:', err);
                setError(err.message || 'Failed to load scenarios');
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [filters]);

    // Handle filter changes
    const handleFilterChange = (newFilters) => {
        setFilters(newFilters);
    };

    // Handle starting a new scenario
    const handleStartScenario = async (scenarioId) => {
        try {
            setLoading(true);
            await createSession(scenarioId);
            // Note: The router.push is now handled in the createSession function
        } catch (err) {
            console.error('Failed to create session:', err);
            setError('Failed to create session. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto px-4 py-8">
            <Head>
                <title>cks CKS - Interactive Kubernetes Security Training</title>
                <meta name="description" content="Practice for the CKS certification with interactive Kubernetes environments" />
            </Head>

            <PageHeader
                title="CKS Practice Labs"
                description="Interactive environments to practice for the Certified Kubernetes Security Specialist exam"
            />

            {/* Filters */}
            <ScenarioFilter
                categories={categories}
                onFilterChange={handleFilterChange}
            />

            {/* Error state */}
            {error && !loading && (
                <ErrorState
                    message="Failed to load scenarios"
                    details={error}
                    onRetry={() => window.location.reload()}
                />
            )}

            {/* Scenarios list */}
            <ScenarioList
                scenarios={scenarios}
                categories={categories}
                onStartScenario={handleStartScenario}
                isLoading={loading}
            />
        </div>
    );
}