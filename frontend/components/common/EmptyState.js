// frontend/components/common/EmptyState.js
import React from 'react';
import Button from './Button';

/**
 * Reusable empty state component
 * @param {Object} props
 * @param {string} props.title - Title for the empty state
 * @param {string} props.message - Description message
 * @param {string} props.actionText - Optional action button text
 * @param {Function} props.onAction - Optional action handler
 */
const EmptyState = ({ title, message, actionText, onAction }) => {
  return (
    <div className="text-center py-12 px-4">
      <svg
        className="mx-auto h-12 w-12 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        ></path>
      </svg>
      <h3 className="mt-2 text-lg font-medium text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-500">{message}</p>
      {actionText && onAction && (
        <div className="mt-6">
          <Button variant="primary" onClick={onAction}>
            {actionText}
          </Button>
        </div>
      )}
    </div>
  );
};

export default EmptyState;