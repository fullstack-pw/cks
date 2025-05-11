// frontend/components/ScenarioFilter.js
import React, { useState, useEffect } from 'react';
import { Card, Select, SearchInput, Button } from './common';

const ScenarioFilter = ({ categories = {}, onFilterChange }) => {
    const [category, setCategory] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [search, setSearch] = useState('');
    const [isFilterActive, setIsFilterActive] = useState(false);
    const [filtersExpanded, setFiltersExpanded] = useState(false);

    // Apply filter changes
    const applyFilters = () => {
        if (onFilterChange) {
            onFilterChange({ category, difficulty, search });
        }
    };

    // Check if any filter is active
    useEffect(() => {
        setIsFilterActive(category || difficulty || search);
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
        <Card className="mb-6">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">Filter Scenarios</h3>

                {/* Mobile toggle button */}
                <div className="md:hidden">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setFiltersExpanded(!filtersExpanded)}
                    >
                        {filtersExpanded ? 'Hide Filters' : 'Show Filters'}
                    </Button>
                </div>
            </div>

            {/* Always visible on desktop, toggle on mobile */}
            <div className={`${filtersExpanded || 'hidden md:block'}`}>
                <div className="space-y-4 md:space-y-0 md:grid md:grid-cols-3 md:gap-4">
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

                {/* Clear filters button - only show if filters are active */}
                {isFilterActive && (
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
        </Card>
    );
};

export default ScenarioFilter;