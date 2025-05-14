// frontend/components/ValidationSummary.js
import React from 'react';

const ValidationSummary = ({ tasks }) => {
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const failedTasks = tasks.filter(t => t.status === 'failed').length;
  const pendingTasks = tasks.filter(t => t.status === 'pending').length;

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-4">
      <h3 className="text-sm font-medium text-gray-700 mb-2">Progress Summary</h3>
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-green-600">{completedTasks}</p>
          <p className="text-xs text-gray-500">Completed</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-red-600">{failedTasks}</p>
          <p className="text-xs text-gray-500">Failed</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-600">{pendingTasks}</p>
          <p className="text-xs text-gray-500">Pending</p>
        </div>
      </div>
    </div>
  );
};

export default ValidationSummary;