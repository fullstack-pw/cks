// frontend/components/TerminalContainer.js
import React from 'react';
import Terminal from './Terminal';
import { Button, LoadingState, ErrorState, StatusIndicator } from './common';
import { useTerminal } from '../hooks/useTerminal';

/**
 * Container component for terminals that manages tabs using the unified useTerminal hook
 */
const TerminalContainer = ({ sessionId }) => {
    const {
        terminals,
        activeTerminal,
        sessionStatus,
        createTerminal,
        switchTerminal,
        handleConnectionChange,
        isSessionReady
    } = useTerminal(sessionId);

    return (
        <div className="h-full flex flex-col">
            {/* Terminal tabs */}
            <div className="bg-gray-800 px-4 py-2 text-white flex overflow-x-auto">
                <Button
                    variant={activeTerminal === 'control-plane' ? 'primary' : 'secondary'}
                    onClick={() => switchTerminal('control-plane')}
                    disabled={!isSessionReady}
                    className={`mr-2 flex items-center ${!isSessionReady ? 'opacity-50' : ''}`}
                >
                    Control Plane
                    {terminals['control-plane'].status === 'connected' && (
                        <StatusIndicator status="connected" size="sm" className="ml-2" />
                    )}
                </Button>

                <Button
                    variant={activeTerminal === 'worker-node' ? 'primary' : 'secondary'}
                    onClick={() => switchTerminal('worker-node')}
                    disabled={!isSessionReady}
                    className={`flex items-center ${!isSessionReady ? 'opacity-50' : ''}`}
                >
                    Worker Node
                    {terminals['worker-node'].status === 'connected' && (
                        <StatusIndicator status="connected" size="sm" className="ml-2" />
                    )}
                </Button>
            </div>

            {/* Terminal content area */}
            <div className="flex-1 overflow-hidden relative">
                {/* Session not ready state */}
                {!isSessionReady && (
                    <div className="flex flex-col justify-center items-center h-full bg-gray-800 text-white p-4">
                        {sessionStatus.isLoading ? (
                            <LoadingState message={sessionStatus.message} size="md" />
                        ) : (
                            <>
                                <p className="text-center mb-2">{sessionStatus.message}</p>
                                {sessionStatus.error && (
                                    <ErrorState
                                        message="Failed to prepare environment"
                                        details={sessionStatus.error}
                                        onRetry={() => window.location.reload()}
                                    />
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Terminal content */}
                {isSessionReady && (
                    <>
                        {/* Control plane terminal */}
                        <div className={`absolute inset-0 transition-opacity duration-300 ${activeTerminal === 'control-plane' ? 'opacity-100 z-10' : 'opacity-0 z-0'
                            }`}>
                            {terminals['control-plane'].id ? (
                                <Terminal
                                    terminalId={terminals['control-plane'].id}
                                    onConnectionChange={(connected) => handleConnectionChange('control-plane', connected)}
                                />
                            ) : (
                                <div className="flex flex-col justify-center items-center h-full bg-gray-800 text-white p-4">
                                    {terminals['control-plane'].isLoading ? (
                                        <LoadingState message="Creating terminal session..." size="md" />
                                    ) : terminals['control-plane'].error ? (
                                        <ErrorState
                                            message="Failed to create terminal"
                                            details={terminals['control-plane'].error}
                                            onRetry={() => createTerminal('control-plane')}
                                        />
                                    ) : (
                                        <Button
                                            variant="primary"
                                            onClick={() => createTerminal('control-plane')}
                                        >
                                            Connect to Control Plane
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Worker node terminal */}
                        <div className={`absolute inset-0 transition-opacity duration-300 ${activeTerminal === 'worker-node' ? 'opacity-100 z-10' : 'opacity-0 z-0'
                            }`}>
                            {terminals['worker-node'].id ? (
                                <Terminal
                                    terminalId={terminals['worker-node'].id}
                                    onConnectionChange={(connected) => handleConnectionChange('worker-node', connected)}
                                />
                            ) : (
                                <div className="flex flex-col justify-center items-center h-full bg-gray-800 text-white p-4">
                                    {terminals['worker-node'].isLoading ? (
                                        <LoadingState message="Creating terminal session..." size="md" />
                                    ) : terminals['worker-node'].error ? (
                                        <ErrorState
                                            message="Failed to create terminal"
                                            details={terminals['worker-node'].error}
                                            onRetry={() => createTerminal('worker-node')}
                                        />
                                    ) : (
                                        <Button
                                            variant="primary"
                                            onClick={() => createTerminal('worker-node')}
                                        >
                                            Connect to Worker Node
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default React.memo(TerminalContainer);