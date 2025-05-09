// frontend/components/common/PageHeader.js
import React from 'react';
import Button from './Button';

/**
 * Reusable page header component
 * @param {Object} props
 * @param {string} props.title - Page title
 * @param {string} props.description - Optional description
 * @param {React.ReactNode} props.actions - Optional action buttons
 */
const PageHeader = ({ title, description, actions }) => {
  return (
    <div className="md:flex md:items-center md:justify-between mb-6">
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-bold leading-7 text-gray-900 sm:text-3xl sm:truncate">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-gray-500">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="mt-4 flex md:mt-0 md:ml-4">
          {actions}
        </div>
      )}
    </div>
  );
};

export default PageHeader;