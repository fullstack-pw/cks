// frontend/components/LabEnvironment.js - Main lab environment component

import React, { useState, useEffect } from 'react';
import useSession from '../hooks/useSession';
import useScenario from '../hooks/useScenario';
import Terminal from './Terminal';
import TaskPanel from './TaskPanel';

const LabEnvironment = ({ sessionId }) => {
    const { session, isLoading: isLoadingSession, isError: sessionError, extendSession } = useSession(sessionId);
    const { scenario, isLoading: isLoadingScenario, isError: scenarioError } = useScenario(session?.scenarioId);
    const [activeTerminal, setActiveTerminal] = useState('control-plane');
    const [terminalSize, setTerminalSize] = useState({ width: 60 });
    const [timeRemaining, setTimeRemaining] = useState(0);

    // Calculate time remaining
    useEffect(() => {
        if (!session) return;

        const updateTimeRemaining = () => {
            const now = new Date();
            const expirationTime = new Date(session.expirationTime);
            const remaining = Math.max(0, Math.floor((expirationTime - now) / 1000 / 60)); // Minutes remaining
            setTimeRemaining(remaining);
        };

        updateTimeRemaining();
        const interval = setInterval(updateTimeRemaining, 60000); // Update every minute

        return () => clearInterval(interval);
    }, [session]);

    // Handle extend session
    const handleExtendSession = async () => {
        try {
            await extendSession(sessionId, 30); // Extend by 30 minutes
        } catch (error) {
            console.error('Failed to extend session:', error);
            alert('Failed to extend session. Please try again.');
        }
    };

    // Handle terminal resize
    const handleResize = (size) => {
        setTerminalSize(size);
    };

    if (isLoadingSession || isLoadingScenario) {
        return (
            <div className="flex justify-center items-center h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    if (sessionError || scenarioError) {
        return (
            <div className="container mx-auto px-4 py-8">
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
                    <p>Failed to load lab environment. Please try again later.</p>
                </div>
            </div>
        );
    }

    if (!session || !scenario) {
        return (
            <div className="container mx-auto px-4 py-8">
                <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
                    <p>Session not found or has expired.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col">
            <header className="bg-white border-b px-4 py-2">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-lg font-medium text-gray-900">{scenario.title}</h1>
                        <p className="text-sm text-gray-500">
                            Session: {sessionId}
                        </p>
                    </div>
                    <div className="flex space-x-4 items-center">
                        <div className="text-sm text-gray-600">
                            <span className={`font-medium ${timeRemaining < 10 ? 'text-red-600' : 'text-gray-900'}`}>
                                {timeRemaining} min
                            </span>{' '}
                            remaining
                        </div>
                        <button
                            onClick={handleExtendSession}
                            className="text-sm bg-indigo-600 text-white py-1 px-3 rounded-md hover:bg-indigo-700"
                        >
                            Extend Time
                        </button>
                    </div>
                </div>
            </header>

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                <div
                    className="w-full md:w-auto flex-1 flex flex-col overflow-hidden"
                    style={{ flexBasis: `${terminalSize.width}%` }}
                >
                    <div className="bg-gray-800 px-4 py-2 text-white flex">
                        <button
                            onClick={() => setActiveTerminal('control-plane')}
                            className={`px-3 py-1 rounded ${activeTerminal === 'control-plane' ? 'bg-gray-700' : 'hover:bg-gray-700'
                                }`}
                        >
                            Control Plane
                        </button>
                        <button
                            onClick={() => setActiveTerminal('worker-node')}
                            className={`px-3 py-1 rounded ml-2 ${activeTerminal === 'worker-node' ? 'bg-gray-700' : 'hover:bg-gray-700'
                                }`}
                        >
                            Worker Node
                        </button>
                    </div>
                    <div className="flex-1 overflow-hidden">
                        {activeTerminal === 'control-plane' && (
                            <Terminal sessionId={sessionId} target={session.controlPlaneVM} />
                        )}
                        {activeTerminal === 'worker-node' && (
                            <Terminal sessionId={sessionId} target={session.workerNodeVM} />
                        )}
                    </div>
                </div>

                <div className="relative flex-none md:w-80 lg:w-96 overflow-hidden border-t md:border-t-0 md:border-l border-gray-200">
                    <div
                        className="absolute md:block h-full w-1 bg-gray-200 hover:bg-gray-300 cursor-ew-resize left-0 top-0 hidden"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            const startX = e.clientX;
                            const startWidth = terminalSize.width;

                            const handleMouseMove = (moveEvent) => {
                                const containerWidth = document.querySelector('.flex-1.flex').offsetWidth;
                                const newWidth = startWidth - ((moveEvent.clientX - startX) / containerWidth) * 100;
                                setTerminalSize({ width: Math.min(Math.max(newWidth, 30), 70) });
                            };

                            const handleMouseUp = () => {
                                document.removeEventListener('mousemove', handleMouseMove);
                                document.removeEventListener('mouseup', handleMouseUp);
                            };

                            document.addEventListener('mousemove', handleMouseMove);
                            document.addEventListener('mouseup', handleMouseUp);
                        }}
                    />
                    <TaskPanel session={session} scenario={scenario} />
                </div>
            </div>
        </div>
    );
};

export default LabEnvironment;