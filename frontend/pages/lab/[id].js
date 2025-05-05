import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import TerminalContainer from '../../components/TerminalContainer';
import TaskPanel from '../../components/TaskPanel';
import { useSession } from '../../contexts/SessionContext';
import ResizablePanel from '../../components/ResizablePanel';

// Specify that this page should hide the header
LabPage.hideHeader = true;

export default function LabPage() {
    const router = useRouter();
    const { id } = router.query;
    const { session, loading, error, fetchSession, extendSession } = useSession();
    const [timeRemaining, setTimeRemaining] = useState(0);
    const [splitSize, setSplitSize] = useState(65);

    // Fetch session on initial load
    useEffect(() => {
        if (id) {
            fetchSession(id);
        }
    }, [id]);

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
                await extendSession(id, 30); // Extend by 30 minutes
            } catch (error) {
                console.error('Failed to extend session:', error);
            }
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto mb-4"></div>
                    <p className="text-gray-600">Loading lab environment...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100">
                <div className="bg-white p-8 rounded-lg shadow-md max-w-md">
                    <h2 className="text-xl font-semibold text-red-600 mb-4">Error Loading Lab Environment</h2>
                    <p className="text-gray-700 mb-4">{error.message || 'Failed to load session data'}</p>
                    <div className="flex space-x-4">
                        <button
                            onClick={() => router.reload()}
                            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                        >
                            Retry
                        </button>
                        <button
                            onClick={() => router.push('/')}
                            className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                        >
                            Return to Home
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100">
                <div className="bg-white p-8 rounded-lg shadow-md max-w-md">
                    <h2 className="text-xl font-semibold text-gray-800 mb-4">Session Not Found</h2>
                    <p className="text-gray-700 mb-4">The requested lab session was not found or has expired.</p>
                    <button
                        onClick={() => router.push('/')}
                        className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    >
                        Return to Home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col">
            <Head>
                <title>Lab Environment | KillerKoda CKS</title>
            </Head>

            {/* Header with session info */}
            <header className="bg-white border-b border-gray-200 px-4 py-2">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-lg font-medium text-gray-900">CKS Lab Environment</h1>
                        <p className="text-sm text-gray-500">
                            Session: {id} | {session.status}
                        </p>
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className={`text-sm ${timeRemaining < 10 ? 'text-red-600' : 'text-gray-600'}`}>
                            <span className="font-medium">{timeRemaining}</span> minutes remaining
                        </div>
                        <button
                            onClick={handleExtendSession}
                            className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                            Extend Time
                        </button>
                        <button
                            onClick={() => router.push('/')}
                            className="inline-flex items-center px-3 py-1 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                        >
                            Exit Lab
                        </button>
                    </div>
                </div>
            </header>

            {/* Main content with resizable panels */}
            <div className="flex flex-1 overflow-hidden">
                <ResizablePanel id="lab-split" direction="horizontal" defaultSize={splitSize} onChange={setSplitSize}>
                    <div className="h-full">
                        <TerminalContainer sessionId={id} />
                    </div>
                    <div className="h-full">
                        <TaskPanel sessionId={id} scenarioId={session.scenarioId} />
                    </div>
                </ResizablePanel>
            </div>
        </div>
    );
}