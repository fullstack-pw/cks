// frontend/components/ValidationDisplay.js
import React, { useState, useCallback } from 'react';
import { Card, Button, StatusIndicator } from './common';

/**
 * Unified validation display component that handles all validation result presentations
 * @param {Object} props
 * @param {string} props.mode - Display mode: 'summary', 'detailed', 'objectives'
 * @param {Object} props.validationResult - Validation result object with success, message, details
 * @param {Array} props.validationRules - Array of validation rules (for objectives mode)
 * @param {Function} props.onRetry - Retry handler for failed validations
 * @param {boolean} props.compact - Whether to use compact display
 * @param {string} props.className - Additional CSS classes
 */
const ValidationDisplay = ({
  mode = 'detailed',
  validationResult,
  validationRules = [],
  onRetry,
  compact = false,
  className = ''
}) => {
  const [expandedRules, setExpandedRules] = useState({});

  // Toggle rule expansion in detailed mode
  const toggleRuleExpansion = useCallback((ruleId) => {
    setExpandedRules(prev => ({
      ...prev,
      [ruleId]: !prev[ruleId]
    }));
  }, []);

  // Helper function to find validation detail for a rule (objectives mode)
  const findValidationDetail = useCallback((ruleId) => {
    if (!validationResult || !validationResult.details) {
      return null;
    }
    return validationResult.details.find(detail => detail.rule === ruleId);
  }, [validationResult]);

  // Generate rule description for objectives mode
  const getValidationObjectiveDescription = useCallback((rule) => {
    switch (rule.type) {
      case 'resource_exists':
        return `${rule.resource.kind} "${rule.resource.name}" must exist in namespace "${rule.resource.namespace || 'default'}"`;
      case 'resource_property':
        return `${rule.resource.kind} "${rule.resource.name}" property ${rule.resource.property} must ${rule.condition} ${rule.value}`;
      case 'command':
        return `Command must ${rule.condition === 'success' ? 'execute successfully' : `have output that ${rule.condition} "${rule.value}"`}`;
      case 'script':
        return `Custom validation script must pass`;
      case 'file_exists':
        return `File "${rule.file.path}" must exist on ${rule.file.target}`;
      case 'file_content':
        return `File "${rule.file.path}" must ${rule.condition} "${rule.value}"`;
      default:
        return rule.description || rule.errorMessage || 'Custom validation';
    }
  }, []);

  // Summary mode - simple progress counts
  if (mode === 'summary') {
    if (!validationResult || !validationResult.details) {
      return null;
    }

    const completedCount = validationResult.details.filter(d => d.passed).length;
    const failedCount = validationResult.details.filter(d => !d.passed).length;
    const totalCount = validationResult.details.length;

    return (
      <Card className={`${compact ? 'p-3' : 'p-4'} ${className}`}>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Validation Progress</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{completedCount}</p>
            <p className="text-xs text-gray-500">Passed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-red-600">{failedCount}</p>
            <p className="text-xs text-gray-500">Failed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-600">{totalCount}</p>
            <p className="text-xs text-gray-500">Total</p>
          </div>
        </div>
      </Card>
    );
  }

  // Objectives mode - shows validation rules as objectives
  if (mode === 'objectives') {
    if (!validationRules || validationRules.length === 0) {
      return null;
    }

    return (
      <Card className={`border-blue-200 bg-blue-50 ${className}`}>
        <div className={compact ? 'p-3' : 'p-4'}>
          <h3 className="text-sm font-medium text-blue-900 mb-3">
            Validation Objectives ({validationRules.length} checks)
            {validationResult && (
              <span className="ml-2 text-xs">
                {validationResult.success ? '✅ All passed' : '❌ Some failed'}
              </span>
            )}
          </h3>
          <div className="space-y-3">
            {validationRules.map((rule, index) => {
              const validationDetail = findValidationDetail(rule.id);
              const validationStatus = validationDetail
                ? (validationDetail.passed ? 'completed' : 'failed')
                : 'pending';

              return (
                <div key={`${rule.id}-${index}`} className={`flex items-start p-2 rounded-md ${validationStatus === 'completed' ? 'bg-green-100 border border-green-200' :
                    validationStatus === 'failed' ? 'bg-red-100 border border-red-200' :
                      'bg-gray-100 border border-gray-200'
                  }`}>
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mr-3 ${validationStatus === 'completed' ? 'bg-green-500' :
                      validationStatus === 'failed' ? 'bg-red-500' : 'bg-gray-400'
                    }`}>
                    {validationStatus === 'completed' ? (
                      <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : validationStatus === 'failed' ? (
                      <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <span className="text-sm font-medium text-white">{index + 1}</span>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center">
                      <p className={`text-sm font-medium ${validationStatus === 'completed' ? 'text-green-800' :
                          validationStatus === 'failed' ? 'text-red-800' : 'text-gray-800'
                        }`}>
                        {getValidationObjectiveDescription(rule)}
                      </p>
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${validationStatus === 'completed' ? 'bg-green-200 text-green-800' :
                          validationStatus === 'failed' ? 'bg-red-200 text-red-800' :
                            'bg-gray-200 text-gray-800'
                        }`}>
                        {validationStatus === 'completed' ? 'Passed' :
                          validationStatus === 'failed' ? 'Failed' : 'Pending'}
                      </span>
                    </div>

                    {rule.description && (
                      <p className="text-xs text-gray-600 mt-1">{rule.description}</p>
                    )}

                    {validationDetail && (
                      <div className={`mt-2 text-xs p-1.5 rounded ${validationDetail.passed ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                        }`}>
                        <strong>{validationDetail.passed ? 'Success: ' : 'Error: '}</strong>
                        {validationDetail.message}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    );
  }

  // Detailed mode - comprehensive validation results
  if (mode === 'detailed') {
    if (!validationResult) return null;

    return (
      <Card className={`mb-6 ${validationResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        } border ${className}`}>
        <div className={compact ? 'p-3' : 'p-4'}>
          {/* Header Section */}
          <div className="flex items-start mb-4">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mr-3 flex-shrink-0 ${validationResult.success ? 'bg-green-500' : 'bg-red-500'
              }`}>
              {validationResult.success ? (
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
              <h3 className={`text-lg font-semibold ${validationResult.success ? 'text-green-900' : 'text-red-900'
                }`}>
                {validationResult.success ? 'Task Validation Successful' : 'Task Validation Failed'}
              </h3>
              <p className={`text-sm mt-1 ${validationResult.success ? 'text-green-700' : 'text-red-700'
                }`}>
                {validationResult.message}
              </p>
            </div>
          </div>

          {/* Progress Summary */}
          {validationResult.details && validationResult.details.length > 0 && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  Validation Progress
                </span>
                <span className={`text-sm font-semibold ${validationResult.success ? 'text-green-600' : 'text-red-600'
                  }`}>
                  {validationResult.details.filter(d => d.passed).length}/{validationResult.details.length} checks passed
                </span>
              </div>
              <div className="mt-2 bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${validationResult.success ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  style={{
                    width: `${(validationResult.details.filter(d => d.passed).length / validationResult.details.length) * 100}%`
                  }}
                />
              </div>
            </div>
          )}

          {/* Detailed Validation Results */}
          {validationResult.details && validationResult.details.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-700">
                Validation Details:
              </h4>
              {validationResult.details.map((detail, index) => (
                <ValidationRuleResult
                  key={`${detail.rule}-${index}`}
                  detail={detail}
                  index={index}
                  isExpanded={expandedRules[detail.rule]}
                  onToggle={() => toggleRuleExpansion(detail.rule)}
                />
              ))}
            </div>
          )}

          {/* Retry button for failed validations */}
          {!validationResult.success && onRetry && (
            <div className="mt-6 flex justify-end">
              <Button
                onClick={onRetry}
                variant="primary"
                size="sm"
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <span className="flex items-center">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.001 8.001 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Retry Validation
                </span>
              </Button>
            </div>
          )}
        </div>
      </Card>
    );
  }

  return null;
};

// Individual validation rule result component (extracted from ValidationResult)
const ValidationRuleResult = ({ detail, index, isExpanded, onToggle }) => {
  return (
    <div className={`border rounded-lg transition-all duration-200 ${detail.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
      }`}>
      <div
        className="p-3 cursor-pointer select-none"
        onClick={onToggle}
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
                {detail.description || `Check ${index + 1}: ${detail.rule}`}
              </p>
              {!isExpanded && !detail.passed && (
                <p className="text-xs mt-0.5 text-red-600">
                  {detail.message.split(':')[0]}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center">
            <span className="text-xs text-gray-500 mr-2">{detail.type}</span>
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

            {/* Show expected vs actual if available */}
            {(detail.expected !== undefined || detail.actual !== undefined) && (
              <div className="mt-3 space-y-2">
                {detail.expected !== undefined && (
                  <div className="flex items-start">
                    <span className="text-xs font-medium text-gray-700 w-20">Expected:</span>
                    <code className="text-xs bg-white px-2 py-1 rounded font-mono flex-1">
                      {JSON.stringify(detail.expected)}
                    </code>
                  </div>
                )}
                {detail.actual !== undefined && (
                  <div className="flex items-start">
                    <span className="text-xs font-medium text-gray-700 w-20">Actual:</span>
                    <code className="text-xs bg-white px-2 py-1 rounded font-mono flex-1">
                      {JSON.stringify(detail.actual)}
                    </code>
                  </div>
                )}
              </div>
            )}

            {/* Show error details if available */}
            {detail.errorDetails && (
              <div className="mt-3">
                <p className="text-xs font-medium text-gray-700">Error Details:</p>
                <code className="text-xs bg-white px-2 py-1 rounded font-mono block mt-1 text-red-600">
                  {detail.errorDetails}
                </code>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ValidationDisplay;