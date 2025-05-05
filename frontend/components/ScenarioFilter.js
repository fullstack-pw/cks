// frontend/components/ScenarioFilter.js - Filtering component for scenarios

import React, { useState } from 'react';

const ScenarioFilter = ({ categories, onFilterChange }) => {
    const [category, setCategory] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [search, setSearch] = useState('');

    // Handle category change
    const handleCategoryChange = (e) => {
        const value = e.target.value;
        setCategory(value);
        onFilterChange({ category: value, difficulty, search });
    };

    // Handle difficulty change
    const handleDifficultyChange = (e) => {
        const value = e.target.value;
        setDifficulty(value);
        onFilterChange({ category, difficulty: value, search });
    };

    // Handle search input change
    const handleSearchChange = (e) => {
        const value = e.target.value;
        setSearch(value);
        onFilterChange({ category, difficulty, search: value });
    };

    // Clear all filters
    const clearFilters = () => {
        setCategory('');
        setDifficulty('');
        setSearch('');
        onFilterChange({ category: '', difficulty: '', search: '' });
    };

    return (
        <div className="bg-white shadow rounded-lg mb-6">
            <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Filter Scenarios</h3>

                <div className="grid grid-cols-1 gap-y-4 gap-x-4 sm:grid-cols-6">
                    {/* Search input */}
                    <div className="sm:col-span-6">
                        <label htmlFor="search" className="block text-sm font-medium text-gray-700">
                            Search
                        </label>
                        <div className="mt-1 relative rounded-md shadow-sm">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <input
                                type="text"
                                name="search"
                                id="search"
                                className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 sm:text-sm border-gray-300 rounded-md"
                                placeholder="Search by title or description"
                                value={search}
                                onChange={handleSearchChange}
                            />
                        </div>
                    </div>

                    {/* Category select */}
                    <div className="sm:col-span-3">
                        <label htmlFor="category" className="block text-sm font-medium text-gray-700">
                            Category
                        </label>
                        <select
                            id="category"
                            name="category"
                            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                            value={category}
                            onChange={handleCategoryChange}
                        >
                            <option value="">All Categories</option>
                            {categories && Object.entries(categories).map(([key, value]) => (
                                <option key={key} value={key}>
                                    {value}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Difficulty select */}
                    <div className="sm:col-span-3">
                        <label htmlFor="difficulty" className="block text-sm font-medium text-gray-700">
                            Difficulty
                        </label>
                        <select
                            id="difficulty"
                            name="difficulty"
                            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
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