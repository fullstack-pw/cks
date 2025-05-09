// frontend/components/ScenarioFilter.js - Updated to use common components

import React, { useState, useEffect } from 'react';
import { Select, SearchInput, Button } from './common';

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

    // Clear all filters
    const clearFilters = () => {
        setCategory('');
        setDifficulty('');
        setSearch('');
    };

    // Create category options for Select
    const categoryOptions = Object.entries(categories).map(([key, value]) => ({
        value: key,
        label: value
    }));

    // Create difficulty options
    const difficultyOptions = [
        { value: 'beginner', label: 'Beginner' },
        { value: 'intermediate', label: 'Intermediate' },
        { value: 'advanced', label: 'Advanced' }
    ];

    return (
        <div className="bg-white shadow rounded-lg mb-6">
            <div className="px-4 py-5 sm:p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Filter Scenarios</h3>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {/* Search input */}
                    <SearchInput
                        value={search}
                        onChange={setSearch}
                        placeholder="Search scenarios..."
                    />

                    {/* Category select */}
                    <Select
                        value={category}
                        onChange={setCategory}
                        options={categoryOptions}
                        label="Category"
                        placeholder="All Categories"
                    />

                    {/* Difficulty select */}
                    <Select
                        value={difficulty}
                        onChange={setDifficulty}
                        options={difficultyOptions}
                        label="Difficulty"
                        placeholder="All Difficulties"
                    />
                </div>

                {/* Clear filters button */}
                {(category || difficulty || search) && (
                    <div className="mt-4 text-right">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={clearFilters}
                        >
                            Clear Filters
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ScenarioFilter;