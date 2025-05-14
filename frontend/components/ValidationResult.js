// frontend/components/ValidationResult.js
import React from 'react';
import { Card } from './common';

const ValidationResult = ({ result }) => {
  if (!result) return null;

  return (
    <Card
      className={`mb-6 ${result.success ? 'bg-green-50' : 'bg-red-50'}`}
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-center mb-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${result.success ? 'bg-green-100' : 'bg-red-100'
            }`}>
            <span className={`text-lg font-bold ${result.success ? 'text-green-600' : 'text-red-600'
              }`}>
              {result.success ? '✓' : '✗'}
            </span>
          </div>
          <div>
            <h3 className={`text-lg font-medium ${result.success ? 'text-green-800' : 'text-red-800'
              }`}>
              {result.success ? 'Task Completed Successfully' : 'Validation Failed'}
            </h3>
            <p className={`text-sm ${result.success ? 'text-green-700' : 'text-red-700'
              }`}>
              {result.message}
            </p>
          </div>
        </div>

        {/* Validation Details */}
        {result.details && result.details.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">
              Validation Details ({result.details.filter(d => d.passed).length}/{result.details.length} passed)
            </h4>
            <div className="space-y-2">
              {result.details.map((detail, index) => (
                <ValidationRuleResult key={index} detail={detail} index={index} />
              ))}
            </div>
          </div>
        )}

        {/* Retry button for failed validations */}
        {!result.success && result.onRetry && (
          <div className="mt-4 border-t pt-4">
            <button
              onClick={result.onRetry}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Retry Validation
            </button>
          </div>
        )}
      </div>
    </Card>
  );
};

// Sub-component for individual validation rules
const ValidationRuleResult = ({ detail, index }) => {
  const [isExpanded, setIsExpanded] = React.useState(!detail.passed);

  return (
    <div
      className={`border rounded-lg p-3 ${detail.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
        }`}
    >
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center">
          <span className={`mr-3 text-sm ${detail.passed ? 'text-green-600' : 'text-red-600'
            }`}>
            {detail.passed ? '✓' : '✗'}
          </span>
          <div>
            <p className={`font-medium text-sm ${detail.passed ? 'text-green-800' : 'text-red-800'
              }`}>
              {detail.rule || `Rule ${index + 1}`}
            </p>
            {!isExpanded && (
              <p className={`text-xs mt-0.5 ${detail.passed ? 'text-green-600' : 'text-red-600'
                }`}>
                {detail.passed ? 'Passed' : 'Failed'}
              </p>
            )}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transform transition-transform ${isExpanded ? 'rotate-180' : ''
            }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expandable details */}
      {isExpanded && (
        <div className="mt-3 pl-9">
          <p className={`text-sm ${detail.passed ? 'text-green-700' : 'text-red-700'
            }`}>
            {detail.message}
          </p>

          {/* Additional debug info in development */}
          {process.env.NODE_ENV === 'development' && detail.debug && (
            <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
              {JSON.stringify(detail.debug, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

export default ValidationResult;