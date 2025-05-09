// frontend/components/common/Select.js
import React from 'react';

/**
 * Reusable select component
 * @param {Object} props
 * @param {string} props.value - Selected value
 * @param {Function} props.onChange - Change handler
 * @param {Array} props.options - Options array with { value, label } objects
 * @param {string} props.label - Input label
 * @param {string} props.placeholder - Select placeholder
 */
const Select = ({
  value,
  onChange,
  options = [],
  label,
  placeholder = 'Select an option',
  className = ''
}) => {
  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full border-gray-300 rounded-md shadow-sm py-2 pl-3 pr-10 text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default Select;