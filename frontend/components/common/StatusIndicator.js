// frontend/components/common/StatusIndicator.js
import React from 'react';

/**
 * Reusable status indicator component
 * @param {Object} props
 * @param {string} props.status - Status value ('connected', 'disconnected', 'error', 'loading', etc.)
 * @param {string} props.label - Optional label to display
 * @param {string} props.size - Size variant ('sm', 'md', 'lg')
 */
const StatusIndicator = ({ status, label, size = 'md' }) => {
  // Map status to colors
  const statusColors = {
    connected: 'bg-green-500',
    running: 'bg-green-500',
    disconnected: 'bg-red-500',
    failed: 'bg-red-500',
    loading: 'bg-yellow-500',
    pending: 'bg-yellow-500',
    provisioning: 'bg-blue-500',
    completed: 'bg-green-500',
  };

  // Size classes
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  };

  const color = statusColors[status] || 'bg-gray-500';
  const sizeClass = sizeClasses[size] || sizeClasses.md;

  return (
    <div className="flex items-center">
      <span className={`${sizeClass} rounded-full ${color} mr-2`}></span>
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
};

export default StatusIndicator;