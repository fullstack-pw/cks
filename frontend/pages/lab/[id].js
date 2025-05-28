// frontend/pages/lab/[id].js

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import TerminalContainer from '../../components/TerminalContainer';
import TaskPanel from '../../components/TaskPanel';
import { useSession } from '../../hooks/useSession';
import { SplitPanel, Button, LoadingState, ErrorState, StatusIndicator } from '../../components/common';

export default function LabPage() {
    const router = useRouter();
    const { id } = router.query;
    const { session, isLoading, isError, error, extendSession } = useSession(id);
    const [timeRemaining, setTimeRemaining] = useState(0);
    const [splitSize, setSplitSize] = useState(65);
    const [isMobile, setIsMobile] = useState(false);
    const [activePanel, setActivePanel] = useState('terminal'); // 'terminal' or 'tasks'

    // Check if mobile on mount and when window resizes
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };

        // Initial check
        checkMobile();

        // Add resize listener
        window.addEventListener('resize', checkMobile);

        // Cleanup
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Calculate time remaining
    useEffect(() => {
        if (!session) return;

        const updateTimeRemaining = () => {
            const now = new Date();
            const expirationTime = new Date(session.expirationTime);
            const remainingMs = Math.max(0, expirationTime - now);
            const remainingMinutes = Math.floor(remainingMs / 1000 / 60);
            setTimeRemaining(remainingMinutes);
        };

        updateTimeRemaining();
        const interval = setInterval(updateTimeRemaining, 60000); // Update every minute

        return () => clearInterval(interval);
    }, [session]);

    // Handle session extension
    const handleExtendSession = async () => {
        if (id) {
            try {
                await extendSession(id, 30);
            } catch (error) {
                console.error('Failed to extend session:', error);
            }
        }
    };

    // Memoize the terminal props to prevent unnecessary re-renders
    const terminalProps = useMemo(() => ({
        sessionId: id
    }), [id]);

    // Memoize the split size handler
    const handleSplitChange = useCallback((newSize) => {
        setSplitSize(newSize);
    }, []);

    if (isLoading && !session) {
        return <LoadingState message="Loading lab environment..." size="lg" />;
    }

    if (isError) {
        return (
            <ErrorState
                message="Error Loading Lab Environment"
                details={error?.message || 'Failed to load session data'}
                onRetry={() => router.reload()}
            />
        );
    }

    if (!session) {
        return (
            <ErrorState
                message="Session Not Found"
                details="The requested lab session was not found or has expired."
                onRetry={() => router.push('/')}
            />
        );
    }

    return (
        <div className="h-screen flex flex-col">
            <Head>
                <title>Lab Environment | CKS Practice</title>
            </Head>

            {/* Header with session info */}
            <header className="bg-white border-b border-gray-200 px-4 py-2">
                <div className="flex flex-col md:flex-row md:justify-between md:items-center">
                    <div>
                        <h1 className="text-lg font-medium text-gray-900 truncate">
                            {session.scenarioId ? `Lab: ${session.scenarioId}` : 'CKS Lab Environment'}
                        </h1>
                        <div className="flex items-center text-sm text-gray-500 mt-1">
                            <span className="mr-2">Session: {id}</span>
                            <StatusIndicator status={session.status} size="sm" />
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center space-x-2 md:space-x-4 mt-2 md:mt-0">
                        <div className={`text-sm ${timeRemaining < 10 ? 'text-red-600' : 'text-gray-600'}`}>
                            <span className="font-medium">{timeRemaining}</span> minutes remaining
                        </div>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={handleExtendSession}
                        >
                            Extend Time
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => router.push('/')}
                        >
                            Exit Lab
                        </Button>
                    </div>
                </div>
            </header>

            {/* Mobile mode panel switcher */}
            {isMobile && (
                <div className="bg-gray-100 px-4 py-2 flex border-b">
                    <Button
                        variant={activePanel === 'terminal' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setActivePanel('terminal')}
                        className="flex-1 mr-2"
                    >
                        Terminal
                    </Button>
                    <Button
                        variant={activePanel === 'tasks' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setActivePanel('tasks')}
                        className="flex-1"
                    >
                        Tasks
                    </Button>
                </div>
            )}

            {/* Main content */}
            <div className="flex-1 overflow-hidden">
                {isMobile ? (
                    // Mobile view
                    activePanel === 'terminal' ? (
                        <div className="h-full">
                            <MemoizedTerminalContainer {...terminalProps} />
                        </div>
                    ) : (
                        <div className="h-full overflow-auto">
                            <TaskPanel sessionId={id} scenarioId={session.scenarioId} />
                        </div>
                    )
                ) : (
                    // Desktop view - split panel
                    <SplitPanel
                        left={<MemoizedTerminalContainer {...terminalProps} />}
                        right={<TaskPanel sessionId={id} scenarioId={session.scenarioId} />}
                        direction="horizontal"
                        defaultSplit={splitSize}
                        onChange={handleSplitChange}
                    />
                )}
            </div>
        </div>
    );
}

// Memoize the TerminalContainer to prevent re-renders during validation
const MemoizedTerminalContainer = React.memo(TerminalContainer);