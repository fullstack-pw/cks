// frontend/components/Terminal.js - Dynamic import with client-side only rendering

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { createTerminalConnection } from '../lib/api';

// Dynamically import xterm with no SSR
const TerminalComponent = dynamic(
    () => import('./TerminalCore'),
    {
        ssr: false, // This will prevent the component from being rendered on the server
        loading: () => (
            <div className="flex justify-center items-center h-full bg-gray-800 text-white">
                <span>Loading terminal...</span>
            </div>
        )
    }
);

// This is your main Terminal component that will be imported by other components
const Terminal = (props) => {
    // Just pass all props to the dynamically loaded component
    return <TerminalComponent {...props} />;
};

export default Terminal;