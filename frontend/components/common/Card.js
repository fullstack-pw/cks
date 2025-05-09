// frontend/components/common/Card.js
import React from 'react';

/**
 * Reusable card component
 * @param {Object} props
 * @param {React.ReactNode} props.children - Card content
 * @param {React.ReactNode} props.header - Optional card header
 * @param {React.ReactNode} props.footer - Optional card footer
 * @param {string} props.className - Additional CSS classes
 */
const Card = ({ children, header, footer, className = '' }) => {
  return (
    <div className={`bg-white rounded-lg shadow overflow-hidden ${className}`}>
      {header && (
        <div className="px-4 py-3 border-b border-gray-200">
          {header}
        </div>
      )}
      <div className="p-4">
        {children}
      </div>
      {footer && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
          {footer}
        </div>
      )}
    </div>
  );
};

export default Card;