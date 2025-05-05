// frontend/components/ResizablePanel.js - Resizable panel component

import React, { useState, useEffect, useRef } from 'react';

const ResizablePanel = ({
    children,
    direction = 'horizontal',
    defaultSize = 50,
    minSize = 10,
    maxSize = 90,
    onChange,
    id
}) => {
    const [size, setSize] = useState(defaultSize);
    const [resizing, setResizing] = useState(false);
    const containerRef = useRef(null);

    // Check if we have exactly two children
    const childrenArray = React.Children.toArray(children);
    if (childrenArray.length !== 2) {
        console.error('ResizablePanel requires exactly two children');
        return <div>{children}</div>;
    }

    // Apply resize on mount or when defaultSize changes
    useEffect(() => {
        setSize(defaultSize);
    }, [defaultSize]);

    // Report size change
    useEffect(() => {
        if (onChange) {
            onChange(size);
        }
    }, [size, onChange]);

    // Handle mouse events for resizing
    const startResize = (e) => {
        e.preventDefault();
        setResizing(true);
    };

    // Handle mouse move during resize
    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!resizing || !containerRef.current) return;

            const containerRect = containerRef.current.getBoundingClientRect();
            let newSize;

            if (direction === 'horizontal') {
                const offsetX = e.clientX - containerRect.left;
                newSize = (offsetX / containerRect.width) * 100;
            } else {
                const offsetY = e.clientY - containerRect.top;
                newSize = (offsetY / containerRect.height) * 100;
            }

            // Clamp the size within min and max bounds
            const clampedSize = Math.max(minSize, Math.min(maxSize, newSize));
            setSize(clampedSize);
        };

        const handleMouseUp = () => {
            setResizing(false);
        };

        if (resizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizing, direction, minSize, maxSize]);

    return (
        <div
            ref={containerRef}
            className={`flex ${direction === 'horizontal' ? 'flex-row' : 'flex-col'} h-full w-full overflow-hidden`}
            id={id}
        >
            {/* First panel */}
            <div
                className="relative overflow-hidden"
                style={{
                    [direction === 'horizontal' ? 'width' : 'height']: `${size}%`,
                    transition: resizing ? 'none' : 'all 0.1s ease'
                }}
            >
                {childrenArray[0]}
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
          ${resizing ? 'bg-indigo-600 opacity-100' : ''}
          transition-colors
          ${direction === 'horizontal' ? 'z-10' : 'z-10'}
        `}
                onMouseDown={startResize}
            >
                {/* Visible handle with larger click area */}
                <div
                    className={`
            ${direction === 'horizontal' ? 'w-1 h-8' : 'h-1 w-8'} 
            bg-current
            ${resizing ? 'bg-indigo-600' : 'bg-gray-400'}
          `}
                />
            </div>

            {/* Second panel */}
            <div
                className="relative overflow-hidden"
                style={{
                    [direction === 'horizontal' ? 'width' : 'height']: `${100 - size}%`,
                    transition: resizing ? 'none' : 'all 0.1s ease'
                }}
            >
                {childrenArray[1]}
            </div>
        </div>
    );
};

export default ResizablePanel;