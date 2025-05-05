// frontend/components/TerminalContainer.js - Container for terminal with tabs and controls

import React, { useState, useEffect } from 'react';
import Terminal from './Terminal';
import { useSession } from '../contexts/SessionContext';

const TerminalContainer = ({ sessionId }) => {
    const { session } = useSession();
    const [activeTab, setActiveTab] = useState('control-plane');
    const [terminals, setTerminals] = useState({
        'control-plane': { connected: false, id: null },
        'worker-node': { connected: false, id: null }
    });
    const [terminalSize, setTerminalSize] = useState({ width: '100%', height: '100%' });

    // Create terminal sessions on initial load
    useEffect(() => {
        if (!session) return;

        const createTerminalSessions = async () => {
            // Only create terminals if they don't exist yet
            if (!terminals['control-plane'].id) {
                await createTerminalSession('control-plane');
            }
        };

        createTerminalSessions();
    }, [session]);

    // Function to create a terminal session
    const createTerminalSession = async (target) => {
        try {
            const { createTerminal } = useSession();
            const result = await createTerminal(sessionId, target);

            setTerminals(prev => ({
                ...prev,
                [target]: {
                    ...prev[target],
                    id: result.terminalId,
                    connected: true
                }
            }));

            return result.terminalId;
        } catch (error) {
            console.error('Failed to create terminal session:', error);
            setTerminals(prev => ({
                ...prev,
                [target]: {
                    ...prev[target],
                    connected: false,
                    error: error.message
                }
            }));
        }
    };

    // Handle terminal disconnect
    const handleDisconnect = (target) => {
        setTerminals(prev => ({
            ...prev,
            [target]: {
                ...prev[target],
                connected: false
            }
        }));
    };

    // Get VM name for target
    const getVMName = (target) => {
        if (!session) return '';

        switch (target) {
            case 'control-plane':
                return session.controlPlaneVM;
            case 'worker-node':
                return session.workerNodeVM;
            default:
                return '';
        }
    };

    // Change active terminal tab
    const handleTabChange = async (target) => {
        setActiveTab(target);

        // Create terminal session if it doesn't exist yet
        if (!terminals[target].id) {
            await createTerminalSession(target);
        }
    };

    if (!session) {
        return (
            <div className="flex items-center justify-center h-full bg-gray-900 text-white">
                <p>Loading session...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Terminal tabs */}
            <div className="flex bg-gray-800 text-gray-300">
                <button
                    onClick={() => handleTabChange('control-plane')}
                    className={`px-4 py-2 text-sm font-medium ${activeTab === 'control-plane'
                            ? 'bg-gray-700 text-white'
                            : 'hover:bg-gray-700 hover:text-white'
                        }`}
                >
                    Control Plane
                </button>
                <button
                    onClick={() => handleTabChange('worker-node')}
                    className={`px-4 py-2 text-sm font-medium ${activeTab === 'worker-node'
                            ? 'bg-gray-700 text-white'
                            : 'hover:bg-gray-700 hover:text-white'
                        }`}
                >
                    Worker Node
                </button>
            </div>

            {/* Status bar */}
            <div className="bg-gray-700 text-gray-300 text-xs px-4 py-1 flex items-center justify-between">
                <div>
                    <span className="font-mono">{getVMName(activeTab)}</span>
                </div>
                <div>
                    <span className={`inline-block w-2 h-2 rounded-full mr-1 ${terminals[activeTab].connected ? 'bg-green-500' : 'bg-red-500'
                        }`}></span>
                    <span>{terminals[activeTab].connected ? 'Connected' : 'Disconnected'}</span>
                </div>
            </div>

            {/* Terminal area */}
            <div className="flex-1 bg-gray-900 overflow-hidden">
                {activeTab === 'control-plane' && terminals['control-plane'].id && (
                    <Terminal
                        sessionId={sessionId}
                        terminalId={terminals['control-plane'].id}
                        target={getVMName('control-plane')}
                        onDisconnect={() => handleDisconnect('control-plane')}
                        size={terminalSize}
                    />
                )}

                {activeTab === 'worker-node' && (
                    terminals['worker-node'].id ? (
                        <Terminal
                            sessionId={sessionId}
                            terminalId={terminals['worker-node'].id}
                            target={getVMName('worker-node')}
                            onDisconnect={() => handleDisconnect('worker-node')}
                            size={terminalSize}
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-white">
                            <button
                                onClick={() => createTerminalSession('worker-node')}
                                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
                            >
                                Connect to Worker Node
                            </button>
                        </div>
                    )
                )}

                {/* Error message */}
                {terminals[activeTab].error && (
                    <div className="absolute bottom-4 right-4 bg-red-600 text-white px-4 py-2 rounded shadow-lg">
                        <p>Error: {terminals[activeTab].error}</p>
                        <button
                            onClick={() => createTerminalSession(activeTab)}
                            className="underline text-sm"
                        >
                            Try again
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TerminalContainer;