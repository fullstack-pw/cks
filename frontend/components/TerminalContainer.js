// frontend/components/TerminalContainer.js - Fix terminal ID handling
import React, { useState, useEffect } from 'react';
import Terminal from './Terminal';
import api from '../lib/api';

const TerminalContainer = ({ sessionId }) => {
    const [activeTab, setActiveTab] = useState('control-plane');
    const [terminals, setTerminals] = useState({
        'control-plane': { connected: false, id: null },
        'worker-node': { connected: false, id: null }
    });
    const [isCreatingTerminal, setIsCreatingTerminal] = useState(false);

    // Create terminal sessions on initial load
    useEffect(() => {
        const createTerminalSession = async (target) => {
            if (terminals[target].id || isCreatingTerminal) return;

            try {
                setIsCreatingTerminal(true);
                console.log(`Creating terminal for ${target}...`);
                const result = await api.terminals.create(sessionId, target);
                console.log(`Terminal created for ${target}:`, result);

                setTerminals(prev => ({
                    ...prev,
                    [target]: {
                        id: result.terminalId,
                        connected: true
                    }
                }));
            } catch (error) {
                console.error(`Failed to create ${target} terminal:`, error);
            } finally {
                setIsCreatingTerminal(false);
            }
        };

        if (sessionId) {
            createTerminalSession('control-plane');
        }
    }, [sessionId, terminals, isCreatingTerminal]);

    // Create terminal for second tab when clicked
    const handleTabChange = async (target) => {
        setActiveTab(target);

        // Create terminal for this tab if it doesn't exist
        if (!terminals[target].id && !isCreatingTerminal) {
            try {
                setIsCreatingTerminal(true);
                const result = await api.terminals.create(sessionId, target);
                setTerminals(prev => ({
                    ...prev,
                    [target]: {
                        id: result.terminalId,
                        connected: true
                    }
                }));
            } catch (error) {
                console.error(`Failed to create ${target} terminal:`, error);
            } finally {
                setIsCreatingTerminal(false);
            }
        }
    };

    return (
        <div className="h-full flex flex-col">
            <div className="bg-gray-800 px-4 py-2 text-white flex">
                <button
                    onClick={() => handleTabChange('control-plane')}
                    className={`px-3 py-1 rounded ${activeTab === 'control-plane' ? 'bg-gray-700' : 'hover:bg-gray-700'}`}
                >
                    Control Plane
                </button>
                <button
                    onClick={() => handleTabChange('worker-node')}
                    className={`px-3 py-1 rounded ml-2 ${activeTab === 'worker-node' ? 'bg-gray-700' : 'hover:bg-gray-700'}`}
                >
                    Worker Node
                </button>
            </div>
            <div className="flex-1 overflow-hidden">
                {terminals[activeTab].id ? (
                    <Terminal
                        sessionId={sessionId}
                        terminalId={terminals[activeTab].id}
                        target={activeTab}
                    />
                ) : (
                    <div className="flex justify-center items-center h-full bg-gray-800 text-white">
                        <span>
                            {isCreatingTerminal ? 'Creating terminal...' : 'Click to connect to terminal'}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TerminalContainer;