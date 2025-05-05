// frontend/pages/lab/[id].js - Lab environment page

import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import LabEnvironment from '../../components/LabEnvironment';
import useSession from '../../hooks/useSession';

export default function LabPage() {
    const router = useRouter();
    const { id } = router.query;
    const { session, isLoading, isError } = useSession(id);

    // Redirect to home if session not found
    useEffect(() => {
        if (!isLoading && (isError || !session)) {
            router.push('/');
        }
    }, [isLoading, isError, session, router]);

    if (!id) {
        return (
            <div className="flex justify-center items-center h-screen">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
            </div>
        );
    }

    return (
        <div>
            <Head>
                <title>Lab Environment | KillerKoda CKS Practice</title>
                <meta name="description" content="Interactive lab environment for CKS practice" />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            <LabEnvironment sessionId={id} />
        </div>
    );
}