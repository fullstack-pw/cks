// frontend/components/Terminal.js - Updated implementation

import React, { useState } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import xterm with no SSR
const TerminalCore = dynamic(
    () => import('./TerminalCore'),
    {
        ssr: false, // This prevents the component from being rendered on the server
        loading: () => (
            <div className="flex justify-center items-center h-full bg-gray-800 text-white">
                <div className="flex flex-col items-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-white mb-2"></div>
                    <span>Loading terminal...</span>
                </div>
            </div>
        )
    }
);

/**
 * Terminal component wrapper that handles dynamic import of the terminal
 * to ensure it only runs on the client side.
 * 
 * @param {Object} props
 * @param {string} props.terminalId - The ID of the terminal session
 * @param {string} props.sessionId - The ID of the user session
 */
const Terminal = ({ terminalId, sessionId }) => {
    const [connected, setConnected] = useState(false);

    // Update parent component with connection status
    const handleConnectionChange = (isConnected) => {
        setConnected(isConnected);
    };

    return (
        <div className="h-full w-full flex flex-col relative">
            {/* Connection indicator */}
            <div className={`absolute top-2 right-2 z-10 flex items-center ${connected ? 'text-green-500' : 'text-red-500'} text-xs font-medium bg-gray-900 bg-opacity-75 px-2 py-1 rounded`}>
                <span className={`inline-block w-2 h-2 rounded-full mr-1 ${connected ? 'bg-green-500' : 'bg-red-500'}`}></span>
                {connected ? 'Connected' : 'Disconnected'}
            </div>

            {/* Terminal core */}
            <TerminalCore
                terminalId={terminalId}
                sessionId={sessionId}
                onConnectionChange={handleConnectionChange}
            />
        </div>
    );
};

export default Terminal;