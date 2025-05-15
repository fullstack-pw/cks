// frontend/components/ValidationResult.js - Final version with scenario context

import React from 'react';
import { Card } from './common';
import { getValidationDescription, getValidationCategory } from '../utils/validationDescriptions';

const ValidationResult = ({ result, onRetry, scenarioId }) => {
  if (!result) return null;

  // Group validations by category
  const groupedDetails = result.details ? result.details.reduce((groups, detail) => {
    const category = getValidationCategory(detail.rule);
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(detail);
    return groups;
  }, {}) : {};

  return (
    <Card
      className={`mb-6 ${result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'} border`}
    >
      <div className="p-4">
        {/* Header Section */}
        <div className="flex items-start mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center mr-3 flex-shrink-0 ${result.success ? 'bg-green-500' : 'bg-red-500'
            }`}>
            {result.success ? (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <h3 className={`text-lg font-semibold ${result.success ? 'text-green-900' : 'text-red-900'
              }`}>
              {result.success ? 'Task Validation Successful' : 'Task Validation Failed'}
            </h3>
            <p className={`text-sm mt-1 ${result.success ? 'text-green-700' : 'text-red-700'
              }`}>
              {result.message}
            </p>
          </div>
        </div>

        {/* Progress Summary */}
        {result.details && result.details.length > 0 && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">
                Validation Progress
              </span>
              <span className={`text-sm font-semibold ${result.success ? 'text-green-600' : 'text-red-600'
                }`}>
                {result.details.filter(d => d.passed).length}/{result.details.length} objectives completed
              </span>
            </div>
            <div className="mt-2 bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${result.success ? 'bg-green-500' : 'bg-red-500'
                  }`}
                style={{
                  width: `${(result.details.filter(d => d.passed).length / result.details.length) * 100}%`
                }}
              />
            </div>
          </div>
        )}

        {/* Grouped Validation Results */}
        {Object.keys(groupedDetails).length > 0 && (
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-700">
              Task Objectives:
            </h4>
            {Object.entries(groupedDetails).map(([category, details]) => (
              <div key={category} className="space-y-2">
                <h5 className="text-xs font-medium text-gray-600 uppercase tracking-wider">
                  {category}
                </h5>
                {details.map((detail, index) => (
                  <ValidationRuleResult
                    key={`${detail.rule}-${index}`}
                    detail={detail}
                    index={index}
                    scenarioId={scenarioId}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Retry button for failed validations */}
        {!result.success && onRetry && (
          <div className="mt-6 flex justify-end">
            <button
              onClick={onRetry}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              <span className="flex items-center">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.001 8.001 0 01-15.357-2m15.357 2H15" />
                </svg>
                Retry Validation
              </span>
            </button>
          </div>
        )}
      </div>
    </Card>
  );
};

// Enhanced sub-component with scenario awareness
const ValidationRuleResult = ({ detail, index, scenarioId }) => {
  const [isExpanded, setIsExpanded] = React.useState(!detail.passed);
  const description = getValidationDescription(detail.rule, scenarioId);

  return (
    <div
      className={`border rounded-lg transition-all duration-200 ${detail.passed ?
          'border-green-200 bg-green-50 hover:bg-green-100' :
          'border-red-200 bg-red-50 hover:bg-red-100'
        }`}
    >
      <div
        className="p-3 cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center flex-1">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center mr-3 flex-shrink-0 ${detail.passed ? 'bg-green-500' : 'bg-red-500'
              }`}>
              {detail.passed ? (
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <p className={`font-medium text-sm ${detail.passed ? 'text-green-800' : 'text-red-800'
                }`}>
                {description}
              </p>
              {!isExpanded && !detail.passed && (
                <p className="text-xs mt-0.5 text-red-600">
                  Click to see details
                </p>
              )}
            </div>
          </div>
          <svg
            className={`w-5 h-5 text-gray-400 transform transition-transform ${isExpanded ? 'rotate-180' : ''
              }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Expandable details */}
      {isExpanded && (
        <div className="px-3 pb-3">
          <div className={`p-3 rounded-md ${detail.passed ? 'bg-green-100' : 'bg-red-100'
            }`}>
            <p className={`text-sm ${detail.passed ? 'text-green-800' : 'text-red-800'
              }`}>
              {detail.message}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ValidationResult;