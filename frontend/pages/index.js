// frontend/pages/index.js - Fixed Home page component

import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import ScenarioFilter from '../components/ScenarioFilter';
import ScenarioList from '../components/ScenarioList';
import api from '../lib/api';

export default function Home() {
    const router = useRouter();
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
            const result = await api.sessions.create(scenarioId);
            router.push(`/lab/${result.sessionId}`);
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

            <h1 className="text-3xl font-bold text-gray-900 mb-6">CKS Practice Labs</h1>

            {/* Filters */}
            <ScenarioFilter
                categories={categories}
                onFilterChange={handleFilterChange}
            />

            {/* Error state */}
            {error && !loading && (
                <div className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
                    <p>{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-2 text-sm underline"
                    >
                        Try again
                    </button>
                </div>
            )}

            {/* Loading state */}
            {loading && (
                <div className="flex justify-center items-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
                </div>
            )}

            {/* Scenarios list */}
            {!loading && !error && (
                <ScenarioList
                    scenarios={scenarios}
                    categories={categories}
                    onStartScenario={handleStartScenario}
                />
            )}
        </div>
    );
}