// frontend/components/common/SplitPanel.js
import React, { useState, useEffect } from 'react';

/**
 * Reusable split panel component with resizing
 * @param {Object} props
 * @param {React.ReactNode} props.left - Left panel content
 * @param {React.ReactNode} props.right - Right panel content
 * @param {string} props.direction - Split direction ('horizontal' or 'vertical')
 * @param {number} props.defaultSplit - Default split percentage (0-100)
 * @param {number} props.minSize - Minimum size percentage
 * @param {number} props.maxSize - Maximum size percentage
 * @param {Function} props.onChange - Split change handler
 */
const SplitPanel = ({
  left,
  right,
  direction = 'horizontal',
  defaultSplit = 50,
  minSize = 20,
  maxSize = 80,
  onChange,
}) => {
  const [splitSize, setSplitSize] = useState(defaultSplit);
  const [isDragging, setIsDragging] = useState(false);

  // Update size on defaults change
  useEffect(() => {
    setSplitSize(defaultSplit);
  }, [defaultSplit]);

  // Report size changes
  useEffect(() => {
    if (onChange) {
      onChange(splitSize);
    }
  }, [splitSize, onChange]);

  // Handle mouse events for dragging
  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;

      // Calculate new split position
      const container = document.getElementById('split-container');
      if (!container) return;

      const rect = container.getBoundingClientRect();
      let newSize;

      if (direction === 'horizontal') {
        newSize = ((e.clientX - rect.left) / rect.width) * 100;
      } else {
        newSize = ((e.clientY - rect.top) / rect.height) * 100;
      }

      // Clamp size to min/max
      newSize = Math.max(minSize, Math.min(maxSize, newSize));
      setSplitSize(newSize);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, direction, minSize, maxSize]);

  return (
    <div
      id="split-container"
      className={`flex ${direction === 'horizontal' ? 'flex-row' : 'flex-col'
        } h-full w-full overflow-hidden`}
    >
      {/* First panel */}
      <div
        className="relative overflow-hidden"
        style={{
          [direction === 'horizontal' ? 'width' : 'height']: `${splitSize}%`,
          transition: isDragging ? 'none' : 'all 0.1s ease'
        }}
      >
        {left}
      </div>

      {/* Resize handle */}
      <div
        className={`
          flex items-center justify-center
          cursor-${direction === 'horizontal' ? 'col' : 'row'}-resize
          ${direction === 'horizontal' ? 'w-1' : 'h-1'} 
          hover:bg-indigo-500 hover:opacity-100
          bg-gray-300 opacity-50
          active:bg-indigo-600
          ${isDragging ? 'bg-indigo-600 opacity-100' : ''}
          transition-colors
          z-10
        `}
        onMouseDown={handleMouseDown}
      >
        {/* Visible handle with larger click area */}
        <div
          className={`
            ${direction === 'horizontal' ? 'w-1 h-8' : 'h-1 w-8'} 
            bg-current
            ${isDragging ? 'bg-indigo-600' : 'bg-gray-400'}
          `}
        />
      </div>

      {/* Second panel */}
      <div
        className="relative overflow-hidden"
        style={{
          [direction === 'horizontal' ? 'width' : 'height']: `${100 - splitSize}%`,
          transition: isDragging ? 'none' : 'all 0.1s ease'
        }}
      >
        {right}
      </div>
    </div>
  );
};

export default SplitPanel;