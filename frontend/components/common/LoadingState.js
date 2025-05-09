// frontend/components/common/LoadingState.js
import React from 'react';

/**
 * Reusable loading state component
 * @param {Object} props
 * @param {string} props.message - Optional loading message
 * @param {string} props.size - Size variant ('sm', 'md', 'lg')
 */
const LoadingState = ({ message = 'Loading...', size = 'md' }) => {
  // Size classes
  const sizes = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  const sizeClass = sizes[size] || sizes.md;

  return (
    <div className="flex flex-col justify-center items-center py-8">
      <div className={`animate-spin rounded-full ${sizeClass} border-b-2 border-indigo-500 mb-4`}></div>
      {message && <p className="text-gray-600">{message}</p>}
    </div>
  );
};

export default LoadingState;