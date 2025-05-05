// frontend/pages/index.js - Updated homepage with scenario browsing

import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Layout from '../components/Layout';
import ScenarioCard from '../components/ScenarioCard';
import ScenarioFilter from '../components/ScenarioFilter';
import { useRouter } from 'next/router';
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

    // Fetch scenarios on initial load
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                // Fetch scenarios
                const scenariosData = await api.scenarios.list();
                setScenarios(scenariosData);

                // Fetch categories
                const categoriesData = await api.scenarios.categories();
                setCategories(categoriesData);
            } catch (err) {
                console.error('Failed to fetch data:', err);
                setError(err.message || 'Failed to load scenarios');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    // Handle filter changes
    const handleFilterChange = (newFilters) => {
        setFilters(newFilters);
    };

    // Apply filters to scenarios
    const filteredScenarios = scenarios.filter(scenario => {
        // Apply category filter
        if (filters.category && !scenario.topics.includes(filters.category)) {
            return false;
        }

        // Apply difficulty filter
        if (filters.difficulty && scenario.difficulty !== filters.difficulty) {
            return false;
        }

        // Apply search filter
        if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            const titleMatches = scenario.title.toLowerCase().includes(searchLower);
            const descriptionMatches = scenario.description.toLowerCase().includes(searchLower);
            const topicMatches = scenario.topics.some(topic => topic.toLowerCase().includes(searchLower));

            if (!titleMatches && !descriptionMatches && !topicMatches) {
                return false;
            }
        }

        return true;
    });

    return (
        <Layout>
            <Head>
                <title>KillerKoda CKS Practice</title>
                <meta name="description" content="Practice for CKS certification with interactive Kubernetes scenarios" />
            </Head>

            <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                <div className="px-4 sm:px-0">
                    <h1 className="text-2xl font-bold text-gray-900 mb-6">CKS Practice Scenarios</h1>

                    {/* Filters */}
                    <ScenarioFilter
                        categories={categories}
                        onFilterChange={handleFilterChange}
                    />

                    {/* Loading state */}
                    {loading && (
                        <div className="flex justify-center items-center py-12">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
                        </div>
                    )}

                    {/* Error state */}
                    {error && !loading && (
                        <div className="rounded-md bg-red-50 p-4 mb-6">
                            <div className="flex">
                                <div className="flex-shrink-0">
                                    <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <div className="ml-3">
                                    <h3 className="text-sm font-medium text-red-800">Failed to load scenarios</h3>
                                    <div className="mt-2 text-sm text-red-700">
                                        <p>{error}</p>
                                    </div>
                                    <div className="mt-4">
                                        <button
                                            type="button"
                                            onClick={() => window.location.reload()}
                                            className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                                        >
                                            Retry
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Scenario grid */}
                    {!loading && !error && (
                        <>
                            {filteredScenarios.length > 0 ? (
                                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                                    {filteredScenarios.map(scenario => (
                                        <ScenarioCard key={scenario.id} scenario={scenario} />
                                    ))}
                                </div>
                            ) : (
                                <div className="bg-white shadow sm:rounded-lg">
                                    <div className="px-4 py-5 sm:p-6">
                                        <h3 className="text-lg leading-6 font-medium text-gray-900">No scenarios found</h3>
                                        <div className="mt-2 max-w-xl text-sm text-gray-500">
                                            <p>No scenarios match your current filters. Try adjusting your search criteria.</p>
                                        </div>
                                        <div className="mt-5">
                                            <button
                                                type="button"
                                                onClick={() => handleFilterChange({ category: '', difficulty: '', search: '' })}
                                                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                                            >
                                                Clear All Filters
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </Layout>
    );
}