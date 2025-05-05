// frontend/components/ScenarioFilter.js - Fixed ScenarioFilter component

import React, { useState, useEffect } from 'react';

const ScenarioFilter = ({ categories = {}, onFilterChange }) => {
    const [category, setCategory] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [search, setSearch] = useState('');

    // Apply filter changes
    const applyFilters = () => {
        if (onFilterChange) {
            onFilterChange({ category, difficulty, search });
        }
    };

    // Apply filters whenever filter values change
    useEffect(() => {
        applyFilters();
    }, [category, difficulty, search]);

    // Handle category change
    const handleCategoryChange = (e) => {
        setCategory(e.target.value);
    };

    // Handle difficulty change
    const handleDifficultyChange = (e) => {
        setDifficulty(e.target.value);
    };

    // Handle search input change with debounce
    const handleSearchChange = (e) => {
        setSearch(e.target.value);
    };

    // Clear all filters
    const clearFilters = () => {
        setCategory('');
        setDifficulty('');
        setSearch('');
    };

    return (
        <div className="bg-white shadow rounded-lg mb-6">
            <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Filter Scenarios</h3>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {/* Search input */}
                    <div>
                        <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
                            Search
                        </label>
                        <div className="relative rounded-md shadow-sm">
                            <input
                                type="text"
                                id="search"
                                className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                                placeholder="Search scenarios..."
                                value={search}
                                onChange={handleSearchChange}
                            />
                        </div>
                    </div>

                    {/* Category select */}
                    <div>
                        <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
                            Category
                        </label>
                        <select
                            id="category"
                            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            value={category}
                            onChange={handleCategoryChange}
                        >
                            <option value="">All Categories</option>
                            {Object.entries(categories).map(([key, value]) => (
                                <option key={key} value={key}>
                                    {value}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Difficulty select */}
                    <div>
                        <label htmlFor="difficulty" className="block text-sm font-medium text-gray-700 mb-1">
                            Difficulty
                        </label>
                        <select
                            id="difficulty"
                            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            value={difficulty}
                            onChange={handleDifficultyChange}
                        >
                            <option value="">All Difficulties</option>
                            <option value="beginner">Beginner</option>
                            <option value="intermediate">Intermediate</option>
                            <option value="advanced">Advanced</option>
                        </select>
                    </div>
                </div>

                {/* Clear filters button */}
                {(category || difficulty || search) && (
                    <div className="mt-4 text-right">
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                            Clear Filters
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ScenarioFilter;